# ☄️ JPEGForge

**JPEGForge** is an advanced, high-fidelity offline WYSIWYG reverse-engineering toolkit designed specifically for tearing apart and physically manipulating the structural metadata of JPEG binary files. 

Built to mirror and expand upon the capabilities of the legendary 010 Editor `JPG.bt` binary templates, JPEGForge provides zero-dependency native ArrayBuffer splicing, intelligent Segment Length auto-patching, and IDE-like Cyber-Synth syntax highlighting for malware analysts and format researchers.

## Features

- **Deep Structural Parsing**: Recursively maps deep JPEG segments (`APP0`, `SOF0`, `DQT`, `DHT`, `SOS`) down to the smallest bitfields without relying on arbitrary external decoders.
- **Cyber-Synth Diagnostics UI**: Pure hex viewers are dead. JPEGForge colorizes structural bounds dynamically. Null padding bytes are dimmed and `FF` metadata markers blaze Neon Orange, letting your eyes instantly discern byte entropy from anchors.
- **Native Drag & Drop Engine**: WYSIWYG array restructuring. Click and drag structure variables (like a localized `Component (Y)`) throughout the component tree. The engine organically detaches the payload, rewrites the raw JSON bounds, and seamlessly calculates/overwrites the binary parent `Segment Length` attributes automatically so you never break an OS parser!
- **Bi-Directional Context**: Hovering over any bare hex byte pops an exact recursive tool-tip pathing indicating exactly what object structural layer (e.g. `JPEG File -> Start of Frame -> Thumbnail Width`) you are looking through. Double-clicking allows in-place hex overwrites or primitive structure edits on the tree.
- **Zero Heavy Dependencies**: The binary engine was written utilizing entirely native DOM HTML5 semantics and strict ES6 `ArrayBuffer` algorithms.

## Quick Start

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. Clone this repository to your local machine:
    ```bash
    git clone https://github.com/ziry4b/jpegforge.git
    cd jpegforge
    ```

2. Install dependencies:
    ```bash
    npm install
    ```

3. Start the internal development server:
    ```bash
    npm run dev
    ```

4. Go to `http://localhost:5173/` in your browser.

## How to use JPEGForge

1. **Upload an Image**: Simply drop a valid `.jpg` or `.jpeg` onto the main workspace. 
2. **Navigate the Tree**: Look to the `Component Tree` side panel to visually examine how your markers map out your file contents structurally.
3. **Execute Struct Rearrangements**: 
    - You can directly natively clone entire segments (Select a row -> `Ctrl+C` -> `Ctrl+V`). The engine seamlessly parses your payload into the `Uint8Array`.
    - You can natively Drag and Drop elements completely across boundary bounds. The engine calculates the Array deflation and offsets dynamically.
    - Press the `Delete` key on any active row to strip its core memory block completely from the master file. All array bounds immediately cascade and repair themselves natively!
4. **Hex Modification**: Double click absolutely any byte in the grid and submit a new raw Hexadecimal value (e.g., `FA`). The change translates natively into the core tree if the tree actively relied upon it.

## Limitations

Currently, JPEGForge inherently treats EXIF payloads (`APP1`) as generic data wrappers. Deep `IFD` Image File Directory unpacking mechanisms are planned for an upcoming patch!

## License
MIT License. Feel free to use and distribute JPEGForge for internal structure analyses.
