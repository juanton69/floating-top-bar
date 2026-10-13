// SPDX-License-Identifier: GPL-3.0-or-later
// Floating, rounded, narrower GNOME top bar. Settings live in prefs.js.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FIXED_THEME_NAME = 'FloatingTopBar';
const BLUR_UUID = 'blur-my-shell@aunetx';
const USER_THEME_UUID = 'user-theme@gnome-shell-extensions.gcampax.github.com';
const BLUR_WIDGET = 'bms-panel-blurred-widget';
const TOP_BAR_PIPELINE = 'pipeline_top_bar';

function settingsFromExtension(uuid, schemaId) {
    const extension = Main.extensionManager.lookup(uuid);
    const dir = extension?.dir?.get_child('schemas');
    if (!dir?.query_exists(null))
        return null;

    let source;
    try {
        source = Gio.SettingsSchemaSource.new_from_directory(
            dir.get_path(),
            Gio.SettingsSchemaSource.get_default(),
            false);
    } catch (error) {
        console.warn(`floating-top-bar: schema source failed: ${error.message}`);
        return null;
    }

    const schema = source.lookup(schemaId, true);
    if (!schema)
        return null;
    return new Gio.Settings({settings_schema: schema});
}

// GJS deepUnpack() opens one variant level. Blur my Shell stores each
// pipeline field in its own variant, so walk until the values are plain.
function unpackValue(value, depth = 0) {
    if (value == null || depth > 32)
        return value;
    if (typeof value.deepUnpack === 'function') {
        const unpacked = value.deepUnpack();
        if (unpacked === value)
            return value;
        return unpackValue(unpacked, depth + 1);
    }
    if (Array.isArray(value))
        return value.map(child => unpackValue(child, depth + 1));
    if (typeof value === 'object' && value.constructor === Object) {
        const result = {};
        for (const [key, child] of Object.entries(value))
            result[key] = unpackValue(child, depth + 1);
        return result;
    }
    return value;
}

function packParam(value) {
    if (typeof value === 'boolean')
        return GLib.Variant.new_boolean(value);
    if (typeof value === 'number' && Number.isInteger(value))
        return GLib.Variant.new_int32(value);
    if (typeof value === 'number')
        return GLib.Variant.new_double(value);
    if (typeof value === 'string')
        return GLib.Variant.new_string(value);
    if (Array.isArray(value) && value.length === 4 &&
        value.every(component => typeof component === 'number'))
        return new GLib.Variant('(dddd)', value);
    throw new Error(`unsupported pipeline parameter ${JSON.stringify(value)}`);
}

function packEffect(effect) {
    const params = {};
    for (const [key, value] of Object.entries(effect.params ?? {}))
        params[key] = packParam(value);
    return new GLib.Variant('a{sv}', {
        type: GLib.Variant.new_string(effect.type),
        id: GLib.Variant.new_string(effect.id),
        params: new GLib.Variant('a{sv}', params),
    });
}

function packPipelines(pipelines) {
    const packed = {};
    for (const [id, pipeline] of Object.entries(pipelines)) {
        packed[id] = {
            name: GLib.Variant.new_string(pipeline.name),
            effects: new GLib.Variant('av', pipeline.effects.map(packEffect)),
        };
    }
    return new GLib.Variant('a{sa{sv}}', packed);
}

function collectNamed(actor, name, found) {
    if (!actor)
        return;
    if (actor.name === name || actor.get_name?.() === name)
        found.push(actor);
    const count = actor.get_n_children?.() ?? 0;
    for (let i = 0; i < count; i++)
        collectNamed(actor.get_child_at_index(i), name, found);
}

export default class FloatingTopBarExtension extends Extension {
    enable() {
        this._applyIdle = 0;
        this._applyTimeout = 0;
        this._startupId = 0;
        this._panelBoxId = 0;
        this._blurOriginalStyles = new Map();
        this._settings = this.getSettings();
        this._originalPanelStyle = Main.panel.style;
        this._lookupCompanions();

        this._settings.connectObject('changed', () => this._queueApply(), this);
        this._extensionStateId = Main.extensionManager.connect(
            'extension-state-changed', () => {
                const hadTheme = this._userTheme !== null;
                const hadBlur = this._blurPanel !== null;
                this._lookupCompanions();
                if ((!hadTheme && this._userTheme) || (!hadBlur && this._blurPanel))
                    this._queueApply();
            });
        this._panelBoxId = Main.layoutManager.panelBox.connect(
            'child-added', () => this._queueApply());

        this._retireFixedTheme();
        this._apply();

        // Blur my Shell, Dash to Dock, and User Themes finish the panel after
        // startup-complete. Re-apply then, plus one short timeout for their idles.
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                this._clearStartup();
                this._onStartupReady();
            });
        } else {
            this._queueApply();
        }
    }

    _lookupCompanions() {
        this._blurSettings ??= settingsFromExtension(
            BLUR_UUID, 'org.gnome.shell.extensions.blur-my-shell');
        this._blurPanel ??= settingsFromExtension(
            BLUR_UUID, 'org.gnome.shell.extensions.blur-my-shell.panel');
        this._userTheme ??= settingsFromExtension(
            USER_THEME_UUID, 'org.gnome.shell.extensions.user-theme');
    }

    disable() {
        this._clearStartup();
        if (this._applyIdle) {
            GLib.source_remove(this._applyIdle);
            this._applyIdle = 0;
        }
        if (this._applyTimeout) {
            GLib.source_remove(this._applyTimeout);
            this._applyTimeout = 0;
        }
        if (this._panelBoxId) {
            Main.layoutManager.panelBox.disconnect(this._panelBoxId);
            this._panelBoxId = 0;
        }
        if (this._extensionStateId) {
            Main.extensionManager.disconnect(this._extensionStateId);
            this._extensionStateId = 0;
        }
        this._settings?.disconnectObject(this);
        this._settings = null;

        Main.panel.style = this._originalPanelStyle;
        this._originalPanelStyle = null;

        for (const [actor, style] of this._blurOriginalStyles ?? []) {
            try {
                if (actor.get_parent())
                    actor.style = style;
            } catch (error) {
                console.warn(`floating-top-bar: could not restore blur style: ${error.message}`);
            }
        }
        this._blurOriginalStyles = null;
        this._blurSettings = null;
        this._blurPanel = null;
        this._userTheme = null;
    }

    _clearStartup() {
        if (!this._startupId)
            return;
        Main.layoutManager.disconnect(this._startupId);
        this._startupId = 0;
    }

    _onStartupReady() {
        this._lookupCompanions();
        this._retireFixedTheme();
        this._apply();
        this._queueApply();
        if (this._applyTimeout)
            GLib.source_remove(this._applyTimeout);
        this._applyTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._applyTimeout = 0;
            if (this._settings)
                this._apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueApply() {
        if (this._applyIdle)
            return;
        this._applyIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._applyIdle = 0;
            if (this._settings)
                this._apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    _apply() {
        const top = this._settings.get_int('top-margin');
        const side = this._settings.get_int('side-margin');
        const bottom = this._settings.get_int('bottom-margin');
        const radius = this._settings.get_int('corner-radius');
        const shadow = this._settings.get_boolean('shadow')
            ? 'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.38);'
            : 'box-shadow: none;';

        Main.panel.style =
            `margin-top: ${top}px; margin-right: ${side}px; ` +
            `margin-bottom: ${bottom}px; margin-left: ${side}px; ` +
            `border-radius: ${radius}px; ${shadow}`;

        this._styleBlurWidgets(radius);
        this._syncBlurRadius(radius);
    }

    _styleBlurWidgets(radius) {
        const found = [];
        collectNamed(Main.layoutManager.panelBox, BLUR_WIDGET, found);
        const style = `border-radius: ${radius}px;`;
        for (const actor of found) {
            if (!this._blurOriginalStyles.has(actor))
                this._blurOriginalStyles.set(actor, actor.style);
            if (actor.style !== style)
                actor.style = style;
        }
    }

    _syncBlurRadius(radius) {
        try {
            if (this._blurPanel?.get_int('corner-radius') !== radius)
                this._blurPanel?.set_int('corner-radius', radius);
            if (!this._blurSettings)
                return;

            const pipelines = unpackValue(this._blurSettings.get_value('pipelines'));
            const pipeline = pipelines?.[TOP_BAR_PIPELINE];
            if (!Array.isArray(pipeline?.effects))
                return;

            let changed = false;
            const effects = pipeline.effects.map(effect => {
                const params = {...(effect.params ?? {})};
                if (effect.type === 'corner' && params.radius !== radius) {
                    params.radius = radius;
                    changed = true;
                }
                return {type: effect.type, id: effect.id, params};
            });
            if (!changed)
                return;

            pipelines[TOP_BAR_PIPELINE] = {name: pipeline.name, effects};
            this._blurSettings.set_value('pipelines', packPipelines(pipelines));
        } catch (error) {
            console.warn(`floating-top-bar: could not update blur radius: ${error.message}`);
        }
    }

    _retireFixedTheme() {
        if (!this._userTheme)
            return;
        if (this._userTheme.get_string('name') !== FIXED_THEME_NAME)
            return;
        this._userTheme.set_string('name', '');
    }
}
