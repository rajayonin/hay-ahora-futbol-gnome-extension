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

export default class HayAhoraFutbolPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "dialog-information-symbolic",
    });
    window.add(page);

    // checking
    const checkingGroup = new Adw.PreferencesGroup({
      title: _("Checking"),
      description: _("Configure how the status is checked"),
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

    const thresholdRow = new Adw.SpinRow({
      title: _("Threshold"),
      subtitle: _(
        "Number of blocked IPs from which football is considered to be on",
      ),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10000,
        step_increment: 1,
        page_increment: 10,
      }),
    });
    thresholdRow.value = settings.get_int("threshold");
    thresholdRow.connect("notify::value", () => {
      settings.set_int("threshold", thresholdRow.value);
    });
    checkingGroup.add(thresholdRow);

    // provider
    const providerGroup = new Adw.PreferencesGroup({
      title: _("Provider"),
      description: _("Which provider's blocked IPs are checked"),
    });
    page.add(providerGroup);

    const autoProviderRow = new Adw.SwitchRow({
      title: _("Automatic provider"),
      subtitle: _(
        "Detect your ISP with ip-api.com; otherwise the check is bypassed and all providers are used",
      ),
    });
    settings.bind(
      "auto-provider",
      autoProviderRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    providerGroup.add(autoProviderRow);

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

    return Promise.resolve();
  }
}
