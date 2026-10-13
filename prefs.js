// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const KEYS = ['top-margin', 'side-margin', 'bottom-margin', 'corner-radius', 'shadow'];

function addSpin(group, settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: 1,
            page_increment: 4,
            value: settings.get_int(key),
        }),
        digits: 0,
    });
    row.connect('notify::value', () => {
        const next = Math.round(row.value);
        if (settings.get_int(key) !== next)
            settings.set_int(key, next);
    });
    settings.connect(`changed::${key}`, () => {
        const next = settings.get_int(key);
        if (Math.round(row.value) !== next)
            row.value = next;
    });
    group.add(row);
    return row;
}

export default class FloatingTopBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Floating Top Bar',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        window.add(page);

        const shape = new Adw.PreferencesGroup({
            title: 'Shape',
            description: 'The bar stays at the top of the primary monitor. Side margin is what makes it narrower.',
        });
        page.add(shape);

        const reset = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
        });
        reset.connect('clicked', () => {
            for (const key of KEYS)
                settings.reset(key);
        });
        shape.set_header_suffix(reset);

        addSpin(shape, settings, 'top-margin', 'Top margin', 'Pixels between the screen edge and the bar', 0, 64);
        addSpin(shape, settings, 'side-margin', 'Side margin', 'Pixels removed from the left and the right', 0, 400);
        addSpin(shape, settings, 'bottom-margin', 'Bottom margin', 'Pixels kept clear above maximized windows', 0, 64);
        addSpin(shape, settings, 'corner-radius', 'Corner radius', 'Rounded corner size, in pixels', 0, 40);

        const shadow = new Adw.SwitchRow({
            title: 'Shadow',
            subtitle: 'Soft shadow under the bar',
        });
        settings.bind('shadow', shadow, 'active', Gio.SettingsBindFlags.DEFAULT);
        shape.add(shadow);
    }
}
