import assert from 'node:assert/strict';

export async function verifyExternalScrollRail(panel, selector) {
 const geometry=await panel.evaluate((panel,selector)=>{
  const scroll=panel.querySelector(selector),box=panel.getBoundingClientRect(),rail=scroll.getBoundingClientRect();
  return {panelRight:box.right,railLeft:rail.right-(scroll.offsetWidth-scroll.clientWidth),railRight:rail.right,
   viewport:innerWidth,overflow:scroll.scrollWidth-scroll.clientWidth,
   thumb:getComputedStyle(scroll,'::-webkit-scrollbar-thumb').backgroundColor};
 },selector);
 assert.ok(geometry.overflow<=1,'Popup content fits without horizontal scrolling');
 assert.ok(geometry.railLeft>=geometry.panelRight+3,'Scrollbar clears the rounded window');
 assert.ok(geometry.railRight<=geometry.viewport-2,'Scrollbar stays accessible inside the viewport');
 assert.match(geometry.thumb,/rgba\([^)]*, 0\.(45|7)\)/,'Scrollbar remains translucent');
 return geometry;
}
