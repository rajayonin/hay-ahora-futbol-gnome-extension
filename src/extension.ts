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

// Mirrors the detection logic used by hayahora.futbol
enum ISP {
  Any = "any",
  Movistar = "movistar",
  DIGI = "digi",
  Vodafone = "vodafone",
  Orange = "orange",
  MásMóvil = "masmovil",
}

const ISP_NAMES: Record<ISP, string> = {
  [ISP.Any]: "any",
  [ISP.Movistar]: "Movistar",
  [ISP.DIGI]: "DIGI",
  [ISP.Vodafone]: "Vodafone",
  [ISP.Orange]: "Orange",
  [ISP.MásMóvil]: "MásMóvil",
};

// Concrete ISPs; `ISP.Any` is the union and is excluded from per-IP counting
const PROVIDERS = [
  ISP.Movistar,
  ISP.DIGI,
  ISP.Vodafone,
  ISP.Orange,
  ISP.MásMóvil,
];

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
 * Parses the ip-api.com 'isp' value.
 */
function parseISP(value: string): ISP | null {
  return (
    ISP_VALUES.get(value) ??
    Object.values(ISP).find(
      (isp) => isp !== ISP.Any && value.toLocaleLowerCase().includes(isp),
    ) ??
    null
  );
}

/**
 * Tunables for the football detection, sourced from the extension settings.
 */
interface EvaluationOptions {
  minISPs: number;
  footballIPThreshold: number;
  keyIPs: string[];
}

/**
 * Replicates hayahora.futbol's status logic from the per-ISP block lists:
 * football is on when more than `footballIPThreshold` IPs are blocked by more
 * than `minISPs` ISPs, or when every key IP is blocked by at least one ISP.
 *
 * @param blockedByISP Blocked IPs per ISP
 * @param options Detection tunables
 * @returns Total number of blocked IPs and whether football is on
 */
function evaluate(
  blockedByISP: Map<ISP, Set<string>>,
  options: EvaluationOptions,
): {
  blocked: number;
  hayFutbol: boolean;
} {
  const ispsPerIP = new Map<string, number>();
  const blockedIPs = new Set<string>();

  for (const isp of PROVIDERS) {
    const ips = blockedByISP.get(isp);
    if (!ips) continue;
    for (const ip of ips) {
      blockedIPs.add(ip);
      ispsPerIP.set(ip, (ispsPerIP.get(ip) ?? 0) + 1);
    }
  }

  const widelyBlocked = [...ispsPerIP.values()].filter(
    (count) => count > options.minISPs,
  ).length;
  const keyPairBlocked =
    options.keyIPs.length > 0 &&
    options.keyIPs.every((ip) => blockedIPs.has(ip));

  return {
    blocked: blockedIPs.size,
    hayFutbol: widelyBlocked > options.footballIPThreshold || keyPairBlocked,
  };
}

/**
 * Removes IPv6 addresses from the per-ISP block lists when they are excluded.
 *
 * @param blockedByISP Blocked IPs per ISP
 * @param includeIPv6 Whether to keep IPv6 addresses
 * @returns The (possibly filtered) block lists
 */
function filterBlockedByISP(
  blockedByISP: Map<ISP, Set<string>>,
  includeIPv6: boolean,
): Map<ISP, Set<string>> {
  if (includeIPv6) return blockedByISP;

  const filtered = new Map<ISP, Set<string>>();
  for (const [isp, ips] of blockedByISP)
    filtered.set(
      isp,
      new Set([...ips].filter((ip) => !ip.includes(":"))),
    );
  return filtered;
}

interface IndicatorOptions {
  notifications: boolean;
  openPreferences: () => void;
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
        (provider !== ISP.Any ? `(${ISP_NAMES[provider]})` : ""),
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

export default class HayAhoraFutbolExtension extends Extension {
  #settings: Gio.Settings | null = null;
  #indicator: Indicator | null = null;
  #session: Soup.Session | null = null;
  #cancellable: Gio.Cancellable | null = null;
  #refreshInProgress: boolean = false;
  #refreshSignalId: number = 0;
  #refreshTimerId: number = 0;
  #settingsSignalIds: number[] = [];
  #blockedByISP: Map<ISP, Set<string>> | null = null;
  #provider: ISP = ISP.Any;

  enable() {
    this.#settings = this.getSettings();

    this.#indicator = new Indicator(this.path, {
      notifications: this.#settings.get_boolean("notifications"),
      openPreferences: () => this.openPreferences(),
    });
    this.#session = new Soup.Session({ timeout: 10 });
    this.#refreshInProgress = false;
    this.#cancellable = new Gio.Cancellable();
    Main.panel.addToStatusArea(this.uuid, this.#indicator);

    // connect indicator's refresh button
    this.#refreshSignalId = this.#indicator.connect("refresh", () => {
      this.refresh();
    });

    // react to settings changes
    this.#settingsSignalIds = [
      this.#settings.connect("changed::notifications", () => {
        this.#indicator?.setNotificationsEnabled(
          this.#settings!.get_boolean("notifications"),
        );
      }),
      this.#settings.connect("changed::refresh-interval", () =>
        this.#scheduleRefresh(),
      ),
      this.#settings.connect("changed::min-isps", () => this.#applyStatus()),
      this.#settings.connect("changed::football-ip-threshold", () =>
        this.#applyStatus(),
      ),
      this.#settings.connect("changed::cf-key-ips", () => this.#applyStatus()),
      this.#settings.connect("changed::include-ipv6", () =>
        this.#applyStatus(),
      ),
    ];

    this.refresh();
    this.#scheduleRefresh();
  }

  disable() {
    if (this.#refreshTimerId) {
      GLib.Source.remove(this.#refreshTimerId);
      this.#refreshTimerId = 0;
    }
    if (this.#settings) {
      for (const id of this.#settingsSignalIds) this.#settings.disconnect(id);
      this.#settingsSignalIds = [];
      this.#settings = null;
    }
    this.#cancellable?.cancel();
    this.#indicator!.disconnect(this.#refreshSignalId);

    this.#indicator!.destroy();
    this.#indicator = null;
    this.#cancellable = null;
    this.#session = null;
    this.#blockedByISP = null;
  }

  /**
   * (Re)schedules the automatic refresh timer using the `refresh-interval`
   * setting (in minutes).
   */
  #scheduleRefresh(): void {
    if (this.#refreshTimerId) {
      GLib.Source.remove(this.#refreshTimerId);
      this.#refreshTimerId = 0;
    }
    const intervalMs = this.#settings!.get_int("refresh-interval") * 60 * 1000;
    this.#refreshTimerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      intervalMs,
      () => {
        this.refresh();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  /**
   * Fetches a URL and returns its body as text.
   * @param url URL to fetch
   */
  async #fetchText(url: string): Promise<string> {
    const msg = Soup.Message.new("GET", url);
    const bytes = await this.#session!.send_and_read_async(
      msg,
      GLib.PRIORITY_DEFAULT,
      this.#cancellable as any, // `as any` bc Glib is being stupid
    );
    if (msg.status_code !== Soup.Status.OK)
      throw new Error(`Request to ${url} returned HTTP ${msg.status_code}`);
    return new TextDecoder().decode(bytes.toArray());
  }

  /**
   * Fetches the blocked IP list of every observed ISP.
   */
  async #fetchBlockedByISP(): Promise<Map<ISP, Set<string>>> {
    const entries = await Promise.all(
      Object.values(ISP).map(async (isp) => {
        const text = await this.#fetchText(`${STATUS_URL}/blocked-${isp}.txt`);
        const ips = new Set(
          text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line),
        );
        return [isp, ips] as const;
      }),
    );
    return new Map(entries);
  }

  /**
   * Detects the current ISP using ip-api.com.
   * @returns Detected IP. `ISP.Any` when it can't be mapped.
   */
  async #detectProvider(): Promise<ISP> {
    try {
      const ispValue = JSON.parse(await this.#fetchText(IP_API_ENDPOINT))
        .isp as string;
      return parseISP(ispValue) ?? ISP.Any;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Unable to fetch ISP: ${message}`);
      return ISP.Any;
    }
  }

  /**
   * Detection tunables from the current settings.
   */
  #evaluationOptions(): EvaluationOptions {
    return {
      minISPs: this.#settings!.get_int("min-isps"),
      footballIPThreshold: this.#settings!.get_int("football-ip-threshold"),
      keyIPs: this.#settings!.get_strv("cf-key-ips"),
    };
  }

  /**
   * Re-evaluates the last fetched status with the current settings.
   */
  #applyStatus(): void {
    if (!this.#blockedByISP) return;

    const blockedByISP = filterBlockedByISP(
      this.#blockedByISP,
      this.#settings!.get_boolean("include-ipv6"),
    );
    const { hayFutbol } = evaluate(blockedByISP, this.#evaluationOptions());
    const count = blockedByISP.get(this.#provider)?.size ?? 0;
    this.#indicator?.update(count, hayFutbol, this.#provider);
  }

  /**
   * Fetches every ISP's block list, evaluates the football state from them and
   * reports the detected ISP's blocked IP count.
   */
  async #fetchStatus(): Promise<void> {
    const [blockedByISP, provider] = await Promise.all([
      this.#fetchBlockedByISP(),
      this.#detectProvider(),
    ]);

    this.#blockedByISP = blockedByISP;
    this.#provider = provider;
    this.#applyStatus();
  }

  /**
   * Refreshes the data.
   */
  async refresh(): Promise<void> {
    if (this.#refreshInProgress || !this.#indicator) return;

    this.#refreshInProgress = true;
    this.#indicator.setRefreshing(true);

    this.#fetchStatus()
      .catch((error) => {
        this.#indicator?.setError(`Unable to fetch status: ${error.message}`);
      })
      .finally(() => {
        this.#refreshInProgress = false;
        this.#indicator?.setRefreshing(false);
      });
  }
}
