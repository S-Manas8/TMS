content = open('frontend/pages/shipper.html', encoding='utf-8').read()

# Find renderShipperAnalytics and wrap it with try/catch + console.error
old = "        function renderShipperAnalytics() {"
new = """        function renderShipperAnalytics() {
            try { _renderShipperAnalyticsInner(); } catch(e) { console.error('Analytics error:', e); document.getElementById('pane-analytics').innerHTML = '<div style="padding:40px;color:#ef4444;font-size:1rem;">Analytics error: ' + e.message + '<br><pre style=\\"font-size:0.75rem;margin-top:8px;\\">' + e.stack + '</pre></div>'; }
        }
        function _renderShipperAnalyticsInner() {"""

# Also need to close the function properly - find the last closing brace of renderShipperAnalytics
# Instead, just add a console.log at the start to debug
old2 = "        function renderShipperAnalytics() {\n            const timeframe = document.getElementById(\"shipper-timeframe\").value;"
new2 = """        function renderShipperAnalytics() {
            console.log('renderShipperAnalytics called, myShipments.length=', myShipments ? myShipments.length : 'undefined');
            const timeframe = document.getElementById("shipper-timeframe").value;"""

if old2 in content:
    content = content.replace(old2, new2, 1)
    print("Added debug log OK")
    open('frontend/pages/shipper.html', 'w', encoding='utf-8').write(content)
else:
    print("Pattern not found, searching for alternatives...")
    idx = content.find('function renderShipperAnalytics')
    print("Found at:", idx)
    print("Context:", repr(content[idx:idx+200]))
