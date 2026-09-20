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

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  EvaluationOptions,
  IP_API_ENDPOINT,
  ISP,
  STATUS_URL,
  evaluate,
  filterBlockedByISP,
  parseISP,
} from "./library.js";

import { parseIconTheme } from "./icons.js";
import { Indicator } from "./indicator.js";

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
      iconTheme: parseIconTheme(this.#settings.get_string("icon-theme")),
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
      this.#settings.connect("changed::auto-detect-provider", () =>
        this.refresh(),
      ),
      this.#settings.connect("changed::min-isps", () => this.#applyStatus()),
      this.#settings.connect("changed::football-ip-threshold", () =>
        this.#applyStatus(),
      ),
      this.#settings.connect("changed::cf-key-ips", () => this.#applyStatus()),
      this.#settings.connect("changed::include-ipv6", () =>
        this.#applyStatus(),
      ),
      this.#settings.connect("changed::icon-theme", () =>
        this.#indicator?.setIconTheme(
          parseIconTheme(this.#settings!.get_string("icon-theme")),
        ),
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
    const { hayFutbol } = evaluate(
      blockedByISP,
      this.#provider,
      this.#evaluationOptions(),
    );
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
      this.#settings!.get_boolean("auto-detect-provider")
        ? this.#detectProvider()
        : Promise.resolve(ISP.Any),
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
