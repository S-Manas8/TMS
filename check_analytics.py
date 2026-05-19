content = open('frontend/pages/shipper.html', encoding='utf-8').read()

# Check switchMainTab function
idx = content.find('async function switchMainTab')
print("switchMainTab found:", idx > 0)
print("Content:", repr(content[idx:idx+400]))
print()

# Check renderShipperAnalytics first 3 lines
idx2 = content.find('function renderShipperAnalytics()')
print("renderShipperAnalytics found:", idx2 > 0)
print("Content:", repr(content[idx2:idx2+200]))
