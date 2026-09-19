/* library.ts
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

export const STATUS_URL = "https://hayahora.futbol/estado";
export const STATUS_PAGE_URL = "https://hayahora.futbol/#estado";
export const IP_API_ENDPOINT = "http://ip-api.com/json/";

// Mirrors the detection logic used by hayahora.futbol
export enum ISP {
  Any = "any",
  Movistar = "movistar",
  DIGI = "digi",
  Vodafone = "vodafone",
  Orange = "orange",
  MásMóvil = "masmovil",
}

export const ISP_NAMES: Record<ISP, string> = {
  [ISP.Any]: "any",
  [ISP.Movistar]: "Movistar",
  [ISP.DIGI]: "DIGI",
  [ISP.Vodafone]: "Vodafone",
  [ISP.Orange]: "Orange",
  [ISP.MásMóvil]: "MásMóvil",
};

// Concrete ISPs; `ISP.Any` is the union and is excluded from per-IP counting
export const PROVIDERS = [
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
export function parseISP(value: string): ISP | null {
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
export interface EvaluationOptions {
  minISPs: number;
  footballIPThreshold: number;
  keyIPs: string[];
}

/**
 * Replicates hayahora.futbol's status logic from the per-ISP block lists:
 * football is on when more than `footballIPThreshold` IPs are blocked by more
 * than `minISPs` ISPs, or when every key IP is blocked by at least one ISP.
 *
 * The state is only reported for the detected provider: even if football is
 * on nationally, it is not considered on when the provider itself has fewer
 * than `footballIPThreshold` blocked IPs.
 *
 * @param blockedByISP Blocked IPs per ISP
 * @param provider Detected ISP
 * @param options Detection tunables
 * @returns Total number of blocked IPs and whether football is on
 */
export function evaluate(
  blockedByISP: Map<ISP, Set<string>>,
  provider: ISP,
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

  const providerBlocked = blockedByISP.get(provider)?.size ?? 0;

  return {
    blocked: blockedIPs.size,
    hayFutbol:
      providerBlocked >= options.footballIPThreshold &&
      (widelyBlocked > options.footballIPThreshold || keyPairBlocked),
  };
}

/**
 * Removes IPv6 addresses from the per-ISP block lists when they are excluded.
 *
 * @param blockedByISP Blocked IPs per ISP
 * @param includeIPv6 Whether to keep IPv6 addresses
 * @returns The (possibly filtered) block lists
 */
export function filterBlockedByISP(
  blockedByISP: Map<ISP, Set<string>>,
  includeIPv6: boolean,
): Map<ISP, Set<string>> {
  if (includeIPv6) return blockedByISP;

  const filtered = new Map<ISP, Set<string>>();
  for (const [isp, ips] of blockedByISP)
    filtered.set(isp, new Set([...ips].filter((ip) => !ip.includes(":"))));
  return filtered;
}
