// Minecraft's sixteen colours, in its order (dyes, wool, glass and terracotta use the index).
export const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
export const COLOR_NAMES = COLORS.map((c) => c.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '));
export const color = (name) => COLORS.indexOf(name);

// texture colours of wool (and dye), and of terracotta, which is duller
export const DYE_RGB = [
  [233, 236, 236], [240, 118, 19], [189, 68, 179], [58, 175, 217], [248, 197, 39], [112, 185, 25], [237, 141, 172], [62, 68, 71],
  [142, 142, 134], [21, 137, 145], [121, 42, 172], [53, 57, 157], [114, 71, 40], [84, 109, 27], [160, 39, 34], [20, 21, 25],
];
export const TERRACOTTA_RGB = [
  [209, 178, 161], [161, 83, 37], [149, 88, 108], [113, 108, 137], [186, 133, 35], [103, 117, 52], [161, 78, 78], [57, 42, 35],
  [135, 106, 97], [86, 91, 91], [118, 70, 86], [74, 59, 91], [77, 51, 35], [76, 83, 42], [143, 61, 46], [37, 22, 16],
];
export const PLAIN_TERRACOTTA_RGB = [152, 94, 67];
