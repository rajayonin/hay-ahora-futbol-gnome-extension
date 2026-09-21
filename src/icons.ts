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

// icon themes bundled with the extension
export enum IconTheme {
  Symbolic = "symbolic",
  GNOME = "gnome",
  Tebas = "tebas",
}

// list of icon themes
export const ICON_THEMES = Object.values(IconTheme);

// theme metadata
const ICON_THEME_META: Record<IconTheme, { name: string; type: string }> = {
  [IconTheme.Symbolic]: { name: "Symbolic", type: "svg" },
  [IconTheme.GNOME]: { name: "GNOME", type: "svg" },
  [IconTheme.Tebas]: { name: "Tebas", type: "png" },
};

// maps icon theme to display name
export const ICON_THEME_NAMES = Object.fromEntries(
  ICON_THEMES.map((theme) => [theme, ICON_THEME_META[theme].name]),
) as Record<IconTheme, string>;

// maps display name to icon theme
export const ICON_THEME_FROM_NAME: Record<string, IconTheme> =
  Object.fromEntries(
    ICON_THEMES.map((theme) => [ICON_THEME_NAMES[theme], theme]),
  );


// indicator states (maps to icon filename)
export enum IconState {
  Football = "furbo",
  NoFootball = "noFurbo",
  Error = "error",
}

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
  return `${extensionPath}/icons/${theme}/${state}.${ICON_THEME_META[theme].type}`;
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
