content = open('frontend/pages/shipper.html', encoding='utf-8').read()

# Find renderShipperAnalytics and show exact first 300 chars
idx = content.find('function renderShipperAnalytics()')
print("Found at:", idx)
print(repr(content[idx:idx+400]))
