NAME=hay-ahora-futbol
DOMAIN=rajayonin
PACK_NAME = $(NAME)@$(DOMAIN).zip

.PHONY: all pack install clean

all: dist/extension.js

bun-lock.json: package.json
	bun install

dist/extension.js dist/prefs.js: bun.lock *.ts
	bun run build

$(PACK_NAME).zip: dist/extension.js dist/prefs.js 
	@cp -r src/icons/ dist/
	@cp metadata.json dist/
	@(cd dist && zip ../$(PACK_NAME).zip -9r .)

pack: $(PACK_NAME).zip

install: $(PACK_NAME).zip
	gnome-extensions install --force $(PACK_NAME).zip

test: clean install
	dbus-run-session gnome-shell --devkit --wayland

clean:
	@rm -rf dist $(PACK_NAME).zip