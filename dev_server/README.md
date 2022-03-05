# ntdf-editor-dev-server

Dev server for editor for Neopets: The Darkest Faerie. See https://github.com/monster860/ntdf-editor for information about the editor.

The purpose of this package is to intercept disk reads and redirect them to the editor, to allow testing without re-saving the whole .ISO file.

Installing:

```
npm install -g ntdf-editor-dev-server
```

Using:
```
ntdf-editor-dev-server
```

You will need a recent build of PCSX2 (Nightly build 1.7.2128 or later) that supports PINE, and ensure System -> Game Settings -> Configure PINE -> Enable PINE is enabled and that the PINE slot is set to the default value of 28011 in PINE Settings. The nightly builds for PCSX2 can be found [here](https://pcsx2.github.io/downloads.html). 


