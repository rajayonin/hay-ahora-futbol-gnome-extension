/* extension.js
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
import Soup from "gi://Soup?version=3.0";
import St from "gi://St";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const STATUS_URL = "https://hayahora.futbol/estado/blocked-any.txt";
const STATUS_PAGE_URL = "https://hayahora.futbol/#estado";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const Indicator = GObject.registerClass(
  {
    Signals: {
      refresh: {},
    },
  },
  class Indicator extends PanelMenu.Button {
    _init(extensionPath) {
      super._init(0.0, _("¿Hay ahora fútbol?"));

      this._extensionPath = extensionPath;

      // icon
      const iconName = "ball-football-off.svg";
      this._icon = new St.Icon({
        gicon: Gio.icon_new_for_string(
          `${this._extensionPath}/icons/${iconName}`,
        ),
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);

      // IP count
      this._countItem = new PopupMenu.PopupMenuItem("", {
        reactive: false,
        can_focus: false,
      });
      this.menu.addMenuItem(this._countItem);

      // refresh button
      this._refreshItem = new PopupMenu.PopupMenuItem(_("Refresh"));
      this._refreshItem.connect("activate", () => this.emit("refresh"));
      this.menu.addMenuItem(this._refreshItem);

      // open status page button
      const statusPageItem = new PopupMenu.PopupMenuItem(_("Open status page"));
      statusPageItem.connect("activate", () => {
        try {
          Gio.AppInfo.launch_default_for_uri(STATUS_PAGE_URL, null);
        } catch (error) {
          console.error(`Unable to open ${STATUS_PAGE_URL}: ${error.message}`);
        }
      });
      this.menu.addMenuItem(statusPageItem);
    }

    /**
     * Updates the indicator according to the number of blocked IPs
     * @param {number} count Number of blocked IPs
     */
    update(count) {
      const iconName =
        count > 0 ? "ball-football.svg" : "ball-football-off.svg";

      this._icon.gicon = Gio.icon_new_for_string(
        `${this._extensionPath}/icons/${iconName}`,
      );
      this._countItem.label.text = _("Blocked IPs: ") + count;
      this.accessible_name = _("Blocked IPs: ") + count;
    }

    /**
     * Temporarily enables/disables the refresh button
     * @param {bool} refreshing
     */
    setRefreshing(refreshing) {
      this._refreshItem.setSensitive(!refreshing);
    }

    /**
     * Shows an error label in the icon
     * @param {string} message Error message
     */
    setError(message) {
      this._countItem.label.text = _("Unable to refresh blocked IPs");
      console.error(message);
    }
  },
);

export default class HayAhoraFutbolExtension extends Extension {
  enable() {
    this._indicator = new Indicator(this.path);
    this._session = new Soup.Session({ timeout: 15 });
    this._cancellable = new Gio.Cancellable();
    this._refreshInProgress = false;
    Main.panel.addToStatusArea(this.uuid, this._indicator);

    // connect indicator's refresh button
    this._refreshSignalId = this._indicator.connect("refresh", () => {
      this._refresh();
    });

    this._refresh();

    // setup autorefresh
    this._refreshTimerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      REFRESH_INTERVAL_MS,
      () => {
        this._refresh();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  disable() {
    if (this._refreshTimerId) {
      GLib.Source.remove(this._refreshTimerId);
      this._refreshTimerId = 0;
    }
    this._cancellable.cancel();
    this._indicator.disconnect(this._refreshSignalId);
    this._indicator.destroy();
    this._indicator = null;
    this._session = null;
    this._cancellable = null;
  }

  async _refresh() {
    if (this._refreshInProgress || !this._indicator) return;

    this._refreshInProgress = true;
    this._indicator.setRefreshing(true);

    try {
      // get data from hayahora.futbol
      const message = Soup.Message.new("GET", STATUS_URL);
      const bytes = await this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        this._cancellable,
      );
      if (message.status_code !== Soup.Status.OK)
        throw new Error(`Status request returned HTTP ${message.status_code}`);

      // count IPs (one line per IP)
      const text = new TextDecoder().decode(bytes.toArray());
      const blockedCount = text
        .split(/\r?\n/)
        .filter((line) => line.trim()).length;
      this._indicator?.update(blockedCount);
    } catch (error) {
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        this._indicator?.setError(
          `Unable to fetch blocked IPs: ${error.message}`,
        );
    } finally {
      this._refreshInProgress = false;
      this._indicator?.setRefreshing(false);
    }
  }
}
