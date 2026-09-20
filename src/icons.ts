/* icons.ts
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

// Icon themes bundled with the extension
export enum IconTheme {
  Symbolic = "symbolic",
  Tebas = "tebas",
}

export const ICON_THEMES = [IconTheme.Symbolic, IconTheme.Tebas];

export const ICON_THEME_NAMES: Record<IconTheme, string> = {
  [IconTheme.Symbolic]: "Symbolic",
  [IconTheme.Tebas]: "Tebas",
};

// Reverse of ICON_THEME_NAMES, to map back the display name shown by the
// preferences combo to its theme
export const ICON_THEME_FROM_NAME: Record<string, IconTheme> =
  Object.fromEntries(
    ICON_THEMES.map((theme) => [ICON_THEME_NAMES[theme], theme]),
  );

// Indicator states; each maps to an icon file
export enum IconState {
  Football = "furbo",
  NoFootball = "noFurbo",
  Error = "error",
}

const ICON_TYPE: Record<IconTheme, string> = {
  [IconTheme.Symbolic]: "svg",
  [IconTheme.Tebas]: "png",
};

/**
 * Absolute path of an icon file for a theme and state.
 * @param extensionPath Extension's installation path
 * @param theme Icon theme
 * @param state Indicator state
 */
export function iconPath(
  extensionPath: string,
  theme: IconTheme,
  state: IconState,
): string {
  return `${extensionPath}/icons/${theme}/${state}.${ICON_TYPE[theme]}`;
}

/**
 * Parses the `icon-theme` setting, falling back to the default theme.
 * @param value Raw setting value
 */
export function parseIconTheme(value: string): IconTheme {
  return ICON_THEMES.includes(value as IconTheme)
    ? (value as IconTheme)
    : IconTheme.Symbolic;
}