NAME=hay-ahora-futbol
DOMAIN=rajayonin
SCHEMA_ID=org.gnome.shell.extensions.$(NAME)
PACK_NAME=$(NAME)@$(DOMAIN)

.PHONY: all pack install clean

all: dist/extension.js dist/indicator.js dist/library.js dist/prefs.js

bun.lock: package.json
	bun install

dist/extension.js dist/indicator.js dist/library.js dist/prefs.js: bun.lock ambient.d.ts src/*.ts
	bun run build

schemas/gschemas.compiled: schemas/$(SCHEMA_ID).gschema.xml
	glib-compile-schemas schemas

$(PACK_NAME).zip: dist/extension.js dist/prefs.js schemas/gschemas.compiled
	@cp -r src/icons/ dist/
	@cp src/stylesheet.css dist/
	@cp metadata.json dist/
	@mkdir -p dist/schemas
	@cp schemas/$(SCHEMA_ID).gschema.xml dist/schemas/
	@(cd dist && zip ../$(PACK_NAME).zip -9r .)

pack: $(PACK_NAME).zip

install: $(PACK_NAME).zip
	gnome-extensions install --force $(PACK_NAME).zip

test: clean install
	dbus-run-session gnome-shell --devkit --wayland

clean:
	@rm -rf dist $(PACK_NAME).zip
