/* indicator.ts
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

import GObject from "gi://GObject";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { ISP, ISP_NAMES, STATUS_PAGE_URL } from "./library.js";

export interface IndicatorOptions {
  notifications: boolean;
  openPreferences: () => void;
}

export class Indicator extends PanelMenu.Button {
  #icon: St.Icon;
  #GICONS: {
    football: Gio.Icon;
    noFootball: Gio.Icon;
    error: Gio.Icon;
  };
  #countItem: PopupMenu.PopupMenuItem;
  #refreshItem: PopupMenu.PopupMenuItem;
  #prefsItem: PopupMenu.PopupMenuItem;
  #notificationSource: MessageTray.Source | null = null;
  #hayFurbo: boolean | null = null;
  #notificationsEnabled: boolean;
  declare public menu: PopupMenu.PopupMenu;

  constructor(extensionPath: string, options: IndicatorOptions) {
    super(0.0, _("¿Hay ahora fútbol?"));

    this.#notificationsEnabled = options.notifications;

    // reduce horizontal padding in the top bar
    this.add_style_class_name("haf-panel-button");

    // define set of icons
    this.#GICONS = {
      football: Gio.icon_new_for_string(
        `${extensionPath}/icons/ball-football.svg`,
      ),
      noFootball: Gio.icon_new_for_string(
        `${extensionPath}/icons/ball-football-off.svg`,
      ),
      error: Gio.icon_new_for_string(
        `${extensionPath}/icons/ball-football-error.svg`,
      ),
    };

    // icon
    this.#icon = new St.Icon({
      gicon: this.#GICONS.error,
      style_class: "system-status-icon",
    }); // default
    this.add_child(this.#icon);

    // IP count (also serves as open page button)
    this.#countItem = new PopupMenu.PopupMenuItem(
      // default parameters
      "Unable to refresh",
      { hover: false, can_focus: false },
    );
    this.#countItem.connect("activate", () => {
      this.#openURL(STATUS_PAGE_URL);
    });
    this.#countItem.accessibleName = "Click to view IPs";
    this.menu.addMenuItem(this.#countItem);

    // separator
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(""));

    // refresh button
    this.#refreshItem = new PopupMenu.PopupMenuItem(_("Refresh"));
    this.#refreshItem.connect("activate", () => this.emit("refresh"));
    this.menu.addMenuItem(this.#refreshItem);

    // preferences button
    this.#prefsItem = new PopupMenu.PopupMenuItem(_("Preferences"));
    this.#prefsItem.connect("activate", options.openPreferences);
    this.menu.addMenuItem(this.#prefsItem);
  }

  /**
   * Opens the URL with the default browser
   * @param url URL to open
   */
  #openURL(url: string): void {
    try {
      Gio.AppInfo.launch_default_for_uri(url, null);
    } catch (error) {
      let msg = "";
      if (error instanceof GLib.Error) {
        msg = `[${error.code}] ${error.message}`;
      } else if (error instanceof Error) {
        msg = error.message;
      } else {
        msg = String(error);
      }
      console.error(`Unable to open ${url}: ${msg}`);
    }
  }

  /**
   * Lazily creates the notification source, reusing it while it is alive.
   */
  #getNotificationSource(): MessageTray.Source {
    if (!this.#notificationSource) {
      this.#notificationSource = new MessageTray.Source({
        title: _("¿Hay ahora fútbol?"),
        icon: this.#GICONS.football,
      });
      this.#notificationSource.connect("destroy", () => {
        this.#notificationSource = null;
      });
      Main.messageTray.add(this.#notificationSource);
    }
    return this.#notificationSource;
  }

  /**
   * Sends a notification about the football state.
   * @param hayFurbo `true` if there is football, `false` if it stopped
   * @param count Number of blocked IPs
   * @param provider Detected ISP
   */
  #notify(hayFurbo: boolean, count: number, provider: ISP): void {
    const source = this.#getNotificationSource();
    const notification = new MessageTray.Notification({
      source,
      title: hayFurbo ? _("Hay fútbol") : _("Ya no hay fútbol"),
      body: hayFurbo
        ? _(
            `${count} blocked IPs (${ISP_NAMES[provider]} provider). Some services may be blocked.`,
          )
        : _("Football broadcasts have ended."),
      urgency: hayFurbo ? MessageTray.Urgency.NORMAL : MessageTray.Urgency.LOW,
    });
    const openStatus = () => this.#openURL(STATUS_PAGE_URL);
    notification.connect("activated", openStatus);
    notification.addAction(_("View IPs"), openStatus);
    source.addNotification(notification);
  }

  /**
   * Enables/Disables the count button
   * @param status `true` to enable, `false` to disable
   */
  #toggleCountButton(status: boolean): void {
    this.#countItem.sensitive = status;
    this.#countItem.reactive = status;
    this.#countItem.can_focus = status;
  }

  /**
   * Updates the indicator with the evaluation of the status data.
   * @param count Number of blocked IPs for the detected ISP
   * @param hayFurbo Whether football is considered to be on
   * @param provider Detected ISP
   */
  update(count: number, hayFurbo: boolean, provider: ISP): void {
    this.accessible_name = hayFurbo ? _("Hay fútbol") : _("No hay fútbol");

    // update menu
    this.#countItem.label.text = _(
      `${count} blocked IPs` +
        (provider !== ISP.Any ? ` (${ISP_NAMES[provider]})` : ""),
    );
    this.#toggleCountButton(true);

    // update icon
    this.#icon.gicon = hayFurbo
      ? this.#GICONS.football
      : this.#GICONS.noFootball;

    // notify on transitions (not on every refresh): when football
    // starts (including the first check) and when it stops
    const started = hayFurbo && this.#hayFurbo !== true;
    const stopped = !hayFurbo && this.#hayFurbo === true;
    if ((started || stopped) && this.#notificationsEnabled) {
      this.#notify(hayFurbo, count, provider);
    }
    this.#hayFurbo = hayFurbo;
  }

  /**
   * Enables/disables notifications on state changes.
   * @param enabled `true` to notify
   */
  setNotificationsEnabled(enabled: boolean): void {
    this.#notificationsEnabled = enabled;
  }

  /**
   * Releases the notification source, if any.
   */
  destroy(): void {
    this.#notificationSource?.destroy(
      MessageTray.NotificationDestroyedReason.SOURCE_CLOSED,
    );
    this.#notificationSource = null;
    super.destroy();
  }

  /**
   * Temporarily enables/disables the refresh button
   * @param refreshing
   */
  setRefreshing(refreshing: boolean) {
    this.#refreshItem.setSensitive(!refreshing);
  }

  /**
   * Shows an error label in the icon
   * @param message Error message
   */
  setError(message: string) {
    // update icon
    this.#icon.gicon = this.#GICONS.error;

    // update count
    this.#countItem.label.text = _("Unable to refresh");
    this.#toggleCountButton(false);

    console.error(message);
  }
}
GObject.registerClass({ Signals: { refresh: {} } }, Indicator);
