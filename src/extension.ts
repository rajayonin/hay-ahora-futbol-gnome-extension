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
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const STATUS_URL = "https://hayahora.futbol/estado";
const STATUS_PAGE_URL = "https://hayahora.futbol/#estado";
const IP_API_ENDPOINT = "http://ip-api.com/json/";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const HAY_FUTBOL_THRESHOLD = 40; // number of blocked IPs in order to consider there is football

enum ISP {
  Any = "any",
  Movistar = "movistar",
  DIGI = "digi",
  Vodafone = "vodafone",
  Orange = "orange",
  MásMóvil = "masmovil",
}

// ISP values according to ip-api.com
const ISP_VALUES = new Map<string, ISP>([
  ["Telefonica de Espana SAU", ISP.Movistar], // Movistar/Telefónica
  ["M247 Europe SRL", ISP.Movistar], // O2
  ["Digi Spain Telecom S.L", ISP.DIGI], // Digi
  ["VODAFONE-NETWORK", ISP.Vodafone], // Vodafone
  ["Vodafone Espana S.A.U.", ISP.Vodafone], // Vodafone
  ["Ono", ISP.Vodafone], // Ono
  ["Orange Spain", ISP.Orange], // Orange/Jazztel
  ["Global ISP by PriorityTelecom Spain", ISP.MásMóvil],
]);

/**
 * Parses the ip-api.com 'isp' values.
 */
function parseISP(value: string): ISP {
  return (
    ISP_VALUES.get(value) ??
    Object.values(ISP).find(
      (isp) => isp !== ISP.Any && value.toLocaleLowerCase().includes(isp),
    ) ??
    ISP.Any
  );
}

class Indicator extends PanelMenu.Button {
  #icon: St.Icon;
  #GICONS: {
    football: Gio.Icon;
    noFootball: Gio.Icon;
    error: Gio.Icon;
  };
  #countItem: PopupMenu.PopupMenuItem;
  #refreshItem: PopupMenu.PopupMenuItem;
  #notificationSource: MessageTray.Source | null = null;
  #hayFurbo: boolean | null = null;
  declare public menu: PopupMenu.PopupMenu;

  constructor(extensionPath: string) {
    super(0.0, _("¿Hay ahora fútbol?"));

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
            `${count} blocked IPs (${provider} provider). Some services may be blocked.`,
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
   * Updates the indicator according to the number of blocked IPs
   * @param count Number of blocked IPs
   */
  update(count: number, provider: ISP): void {
    const hayFurbo = count > HAY_FUTBOL_THRESHOLD;
    this.accessible_name = hayFurbo ? _("Hay fútbol") : _("No hay fútbol");

    // update menu
    this.#countItem.label.text = _(`${count} blocked IPs (${provider})`);
    this.#toggleCountButton(true);

    // update icon
    this.#icon.gicon = hayFurbo
      ? this.#GICONS.football
      : this.#GICONS.noFootball;

    // notify on transitions (not on every refresh): when football
    // starts (including the first check) and when it stops
    const started = hayFurbo && this.#hayFurbo !== true;
    const stopped = !hayFurbo && this.#hayFurbo === true;
    if (started || stopped) {
      this.#notify(hayFurbo, count, provider);
    }
    this.#hayFurbo = hayFurbo;
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

export default class HayAhoraFutbolExtension extends Extension {
  gsettings?: Gio.Settings;
  #indicator: Indicator | null = null;
  #session: Soup.Session | null = null;
  #cancellable: Gio.Cancellable | null = null;
  #refreshInProgress: boolean = false;
  #refreshSignalId: number = 0;
  #refreshTimerId: number = 0;

  enable() {
    this.#indicator = new Indicator(this.path);
    this.#session = new Soup.Session({ timeout: 10 });
    this.#refreshInProgress = false;
    this.#cancellable = new Gio.Cancellable();
    Main.panel.addToStatusArea(this.uuid, this.#indicator);

    // connect indicator's refresh button
    this.#refreshSignalId = this.#indicator.connect("refresh", () => {
      this.refresh();
    });

    this.refresh();

    // setup autorefresh
    this.#refreshTimerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      REFRESH_INTERVAL_MS,
      () => {
        this.refresh();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  disable() {
    if (this.#refreshTimerId) {
      GLib.Source.remove(this.#refreshTimerId);
      this.#refreshTimerId = 0;
    }
    this.#cancellable?.cancel();
    this.#indicator!.disconnect(this.#refreshSignalId);

    this.#indicator!.destroy();
    this.#indicator = null;
    this.#cancellable = null;
    this.#session = null;
  }

  /**
   * Gets the provider. By default, `ISP.Any`.
   */
  async #getProvider(): Promise<ISP> {
    const msg = Soup.Message.new("GET", IP_API_ENDPOINT);
    return this.#session!.send_and_read_async(
      msg,
      GLib.PRIORITY_DEFAULT,
      this.#cancellable as any, // `as any` bc Glib is being stupid
    )
      .then((bytes) => {
        if (msg.status_code !== Soup.Status.OK)
          throw new Error(`Provider request returned HTTP ${msg.status_code}`);

        // extract ISP
        const ispValue = JSON.parse(
          new TextDecoder().decode(bytes.toArray()),
        ).isp;
        return parseISP(ispValue);
      })
      .catch((error) => {
        console.log(`Unable to fetch ISP: ${error.message}`);
        return ISP.Any;
      });
  }

  /**
   * Gets the number of blocked ISPs for the specified provider.
   */
  async #getCount(provider: ISP) {
    const statusMsg = Soup.Message.new(
      "GET",
      `${STATUS_URL}/blocked-${provider}.txt`,
    );
    this.#session!.send_and_read_async(
      statusMsg,
      GLib.PRIORITY_DEFAULT,
      this.#cancellable as any, // `as any` bc Glib is being stupid
    )
      .then((bytes) => {
        if (statusMsg.status_code !== Soup.Status.OK)
          throw new Error(
            `Status request returned HTTP ${statusMsg.status_code}`,
          );

        // count IPs (one line per IP)
        const text = new TextDecoder().decode(bytes.toArray());
        const blockedCount = text
          .split(/\r?\n/)
          .filter((line) => line.trim()).length;
        this.#indicator?.update(blockedCount, provider);
      })
      .catch((error) => {
        this.#indicator?.setError(
          `Unable to fetch blocked IPs: ${error.message}`,
        );
      });
  }

  /**
   * Refreshes the data.
   */
  async refresh(): Promise<void> {
    if (this.#refreshInProgress || !this.#indicator) return;

    this.#refreshInProgress = true;
    this.#indicator.setRefreshing(true);

    this.#getProvider()
      .then((p) => this.#getCount(p))
      .finally(() => {
        this.#refreshInProgress = false;
        this.#indicator?.setRefreshing(false);
      });
  }
}
