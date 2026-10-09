const api = require('../public/report-export');
const {withFineRange} = require('./fine-summary');
module.exports = Object.fromEntries(Object.entries(api).map(([name, render]) => [name, audit => render(withFineRange(audit))]));
