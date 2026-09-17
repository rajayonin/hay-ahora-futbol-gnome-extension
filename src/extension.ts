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
import St from "gi://St";
import Soup from "gi://Soup";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const STATUS_URL = "https://hayahora.futbol/estado/blocked-any.txt";
const STATUS_PAGE_URL = "https://hayahora.futbol/#estado";
const CHECKER_PAGE_URL = "https://hayahora.futbol/#comprobador";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

class Indicator extends PanelMenu.Button {
  private _icon: St.Icon;
  private _GICONS: {
    football: Gio.Icon;
    noFootball: Gio.Icon;
    error: Gio.Icon;
  };
  private _countItem: PopupMenu.PopupMenuItem;
  private _refreshItem: PopupMenu.PopupMenuItem;
  declare public menu: PopupMenu.PopupMenu;

  constructor(extensionPath: string) {
    super(0.0, _("¿Hay ahora fútbol?"));

    // define set of icons
    this._GICONS = {
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
    this._icon = new St.Icon({
      gicon: this._GICONS.error,
      style_class: "system-status-icon",
    }); // default
    this.add_child(this._icon);

    // IP count (also serves as open page button)
    this._countItem = new PopupMenu.PopupMenuItem("");
    this._countItem.connect("activate", () => {
      this.#openURL(STATUS_PAGE_URL);
    });
    this.menu.addMenuItem(this._countItem);

    // separator
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(""));

    // refresh button
    this._refreshItem = new PopupMenu.PopupMenuItem(_("Refresh"));
    this._refreshItem.connect("activate", () => this.emit("refresh"));
    this.menu.addMenuItem(this._refreshItem);

    // check webpage
    const checkPage = new PopupMenu.PopupMenuItem("Check webpage");
    checkPage.connect("activate", () => {
      this.#openURL(CHECKER_PAGE_URL);
    });
    this.menu.addMenuItem(checkPage)
  }

  #openURL(url: string) {
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
   * Updates the indicator according to the number of blocked IPs
   * @param count Number of blocked IPs
   */
  update(count: number) {
    const hayFurbo = count > 0;
    this.accessible_name = hayFurbo ? _("Hay fútbol") : _("No hay fútbol");

    // update menu
    this._countItem.label.text = _(`${count} blocked IPs`);
    this._countItem.sensitive = hayFurbo;
    this._countItem.reactive = hayFurbo;
    this._countItem.can_focus = hayFurbo;

    // update icon
    this._icon.gicon =
      count > 0 ? this._GICONS.football : this._GICONS.noFootball;
  }

  /**
   * Temporarily enables/disables the refresh button
   * @param refreshing
   */
  setRefreshing(refreshing: boolean) {
    this._refreshItem.setSensitive(!refreshing);
  }

  /**
   * Shows an error label in the icon
   * @param message Error message
   */
  setError(message: string) {
    this._icon.gicon = this._GICONS.error;
    this._countItem.label.text = _("Unable to refresh blocked IPs");
    console.error(message);
  }
}
GObject.registerClass({ Signals: { refresh: {} } }, Indicator);

export default class HayAhoraFutbolExtension extends Extension {
  gsettings?: Gio.Settings;
  private _indicator: Indicator | null = null;
  private _session: Soup.Session | null = null;
  private _cancellable: Gio.Cancellable | null = null;
  private _refreshInProgress: boolean = false;
  private _refreshSignalId: number = 0;
  private _refreshTimerId: number = 0;

  enable() {
    this._indicator = new Indicator(this.path);
    this._session = new Soup.Session({ timeout: 15 });
    this._refreshInProgress = false;
    this._cancellable = new Gio.Cancellable();
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
    this._cancellable?.cancel();
    this._indicator!.disconnect(this._refreshSignalId);

    this._indicator!.destroy();
    this._indicator = null;
    this._cancellable = null;
    this._session = null;
  }

  async _refresh() {
    if (this._refreshInProgress || !this._indicator) return;

    this._refreshInProgress = true;
    this._indicator.setRefreshing(true);

    // get data from hayahora.futbol
    const message = Soup.Message.new("GET", STATUS_URL);
    this._session!.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      this._cancellable as any, // `as any` bc Glib is being stupid
    )
      .then((bytes) => {
        if (message.status_code !== Soup.Status.OK)
          throw new Error(
            `Status request returned HTTP ${message.status_code}`,
          );

        // count IPs (one line per IP)
        const text = new TextDecoder().decode((bytes as GLib.Bytes).toArray());
        const blockedCount = text
          .split(/\r?\n/)
          .filter((line) => line.trim()).length;
        this._indicator?.update(blockedCount);
      })
      .catch((error) => {
        if (error instanceof Error && error.message.includes("Cancelled")) {
          this._indicator?.setError(
            `Unable to fetch blocked IPs: ${error.message}`,
          );
        }
      })
      .finally(() => {
        this._refreshInProgress = false;
        this._indicator?.setRefreshing(false);
      });
  }
}
