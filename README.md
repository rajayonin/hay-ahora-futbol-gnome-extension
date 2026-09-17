# ¿Hay ahora fútbol? GNOME extension
A GNOME extension to check if IPs are blocked in Spain due to football broadcasts, using [hayahora.futbol](https://hayahora.futbol).


## Developing
1. Clone the repo:
   ```
   git clone https://github.com/rajayonin/hayahorafutbol-gnome-extension.git
   ```
2. Install the extension:
    ```
    ln -s "$(pwd)/hayahorafutbol-gnome-extension" ~/.local/share/gnome-shell/extensions/hayahorafutbol@rajayonin
    ```
3. [Wayland] Launch a [new Wayland sub-session](https://gjs.guide/extensions/development/creating.html#wayland-sessions):
    ```
    dbus-run-session gnome-shell --devkit --wayland
    ```
4. [Inside the sub-session] Enable the extension:
    ```
    gnome-extensions enable hayahorafutbol@rajayonin
    ```
