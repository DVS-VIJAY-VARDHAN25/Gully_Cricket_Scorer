// Run with: node make-single.js
// Copies style.css, engine.js and app.js INTO index.html and writes gully-scorer-single.html,
// one file that works on its own (handy for sending to a phone or opening from a chat).
const fs = require('fs');
let html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const css = fs.readFileSync(__dirname + '/style.css', 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, file) =>
  '<script>\n' + fs.readFileSync(__dirname + '/' + file, 'utf8').replace(/<\/script>/g, '<\\/script>') + '\n</script>');
fs.writeFileSync(__dirname + '/gully-scorer-single.html', html);
console.log('wrote gully-scorer-single.html', html.length, 'bytes');
