/* prefs.ts
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import {
  ICON_THEMES,
  ICON_THEME_FROM_NAME,
  ICON_THEME_NAMES,
  IconState,
  IconTheme,
  iconPath,
  parseIconTheme,
} from "./icons.js";

export default class HayAhoraFutbolPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "dialog-information-symbolic",
    });
    window.add(page);

    // notifications
    const notificationsGroup = new Adw.PreferencesGroup({
      title: _("Notifications"),
      description: _("Get notified when football starts or ends"),
    });
    page.add(notificationsGroup);

    const notificationsRow = new Adw.SwitchRow({
      title: _("Enable notifications"),
    });
    settings.bind(
      "notifications",
      notificationsRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    notificationsGroup.add(notificationsRow);


    // appearance
    const appearanceGroup = new Adw.PreferencesGroup({
      title: _("Appearance"),
      description: _("Choose the icon theme shown in the top bar"),
    });
    page.add(appearanceGroup);

    const themeModel = new Gtk.StringList();
    for (const theme of ICON_THEMES) themeModel.append(ICON_THEME_NAMES[theme]);

    const themeRow = new Adw.ComboRow({
      title: _("Icon theme"),
      model: themeModel,
    });

    const themeFactory = new Gtk.SignalListItemFactory();
    themeFactory.connect("setup", (_factory, listItem) => {
      const item = listItem as Gtk.ListItem;
      const box = new Gtk.Box({ spacing: 12 });
      box.append(new Gtk.Image({ pixel_size: 24 }));
      box.append(new Gtk.Label({ xalign: 0 }));
      item.child = box;
    });
    themeFactory.connect("bind", (_factory, listItem) => {
      const item = listItem as Gtk.ListItem;
      const name = (item.item as Gtk.StringObject).string;
      const theme = ICON_THEME_FROM_NAME[name] ?? IconTheme.Symbolic;
      const box = item.child as Gtk.Box;
      const image = box.get_first_child() as Gtk.Image;
      const label = image.get_next_sibling() as Gtk.Label;
      image.file = iconPath(this.path, theme, IconState.Football);
      label.label = ICON_THEME_NAMES[theme];
    });
    themeRow.factory = themeFactory;

    themeRow.selected = Math.max(
      0,
      ICON_THEMES.indexOf(parseIconTheme(settings.get_string("icon-theme"))),
    );
    themeRow.connect("notify::selected", () => {
      settings.set_string("icon-theme", ICON_THEMES[themeRow.selected]);
    });
    appearanceGroup.add(themeRow);


    // checking
    const checkingGroup = new Adw.PreferencesGroup({
      title: _("Refresh"),
      // description: _("Configure how the status is checked"),
    });
    page.add(checkingGroup);

    const refreshRow = new Adw.SpinRow({
      title: _("Refresh interval"),
      subtitle: _("Minutes between automatic checks"),
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 1440,
        step_increment: 1,
        page_increment: 5,
      }),
    });
    refreshRow.value = settings.get_int("refresh-interval");
    refreshRow.connect("notify::value", () => {
      settings.set_int("refresh-interval", refreshRow.value);
    });
    checkingGroup.add(refreshRow);

    const autoDetectRow = new Adw.SwitchRow({
      title: _("Automatic provider detection"),
      subtitle: _(
        "Detect your provider with ip-api.com; otherwise the aggregate list is used",
      ),
    });
    settings.bind(
      "auto-detect-provider",
      autoDetectRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    checkingGroup.add(autoDetectRow);

    // detection
    const detectionGroup = new Adw.PreferencesGroup({
      title: _("Football detection"),
      description: _("Tune how the football state is derived from blocked IPs"),
    });
    page.add(detectionGroup);

    const ipv6Row = new Adw.SwitchRow({
      title: _("Include IPv6 addresses"),
      subtitle: _(
        "Count IPv6 addresses when evaluating the football state and the IP count",
      ),
    });
    settings.bind(
      "include-ipv6",
      ipv6Row,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    detectionGroup.add(ipv6Row);

    const minISPsRow = new Adw.SpinRow({
      title: _("Minimum ISPs"),
      subtitle: _(
        "An IP is widely blocked when more than this many ISPs block it",
      ),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 1,
        page_increment: 1,
      }),
    });
    minISPsRow.value = settings.get_int("min-isps");
    minISPsRow.connect("notify::value", () => {
      settings.set_int("min-isps", minISPsRow.value);
    });
    detectionGroup.add(minISPsRow);

    const thresholdRow = new Adw.SpinRow({
      title: _("Football IP threshold"),
      subtitle: _(
        "Football is on when more than this many widely blocked IPs exist",
      ),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10000,
        step_increment: 1,
        page_increment: 10,
      }),
    });
    thresholdRow.value = settings.get_int("football-ip-threshold");
    thresholdRow.connect("notify::value", () => {
      settings.set_int("football-ip-threshold", thresholdRow.value);
    });
    detectionGroup.add(thresholdRow);

    const keyIPsRow = new Adw.EntryRow({
      title: _("Cloudflare key IPs"),
      show_apply_button: true,
    });
    keyIPsRow.text = settings.get_strv("cf-key-ips").join(", ");
    keyIPsRow.connect("apply", () => {
      const keyIPs = keyIPsRow.text
        .split(",")
        .map((ip) => ip.trim())
        .filter((ip) => ip);
      settings.set_strv("cf-key-ips", keyIPs);
    });
    detectionGroup.add(keyIPsRow);

    return Promise.resolve();
  }
}
