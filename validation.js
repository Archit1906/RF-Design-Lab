const fs = require('fs');
const html = fs.readFileSync('rf-design-lab (2).html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (match) {
  fs.writeFileSync('temp_test.js', match[1]);
  try {
    require('child_process').execSync('node -c temp_test.js', {stdio: 'inherit'});
    console.log('Syntax OK');
  } catch(e) {
    console.log('Syntax error check failed');
  }
} else {
  console.log('No script found');
}
