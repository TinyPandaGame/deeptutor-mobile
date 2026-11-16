// Formula canvases handle their own touch events. A stationary long press opens
// the same native message menu; moving/scrolling cancels it. No network access.
export const chatLongPressScript = `
document.documentElement.style.userSelect = 'none';
document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
var holdTimer = null, holdStart = null;
function cancelHold(){ clearTimeout(holdTimer); holdTimer = null; holdStart = null; }
document.addEventListener('pointerdown', function(e){
  cancelHold(); if(e.isPrimary === false) return;
  holdStart = [e.clientX, e.clientY];
  holdTimer = setTimeout(function(){ cancelHold(); window.ReactNativeWebView.postMessage('chat-long-press'); }, 500);
});
document.addEventListener('pointermove', function(e){
  if(holdStart && (Math.abs(e.clientX-holdStart[0]) > 8 || Math.abs(e.clientY-holdStart[1]) > 8)) cancelHold();
});
document.addEventListener('pointerup', cancelHold);
document.addEventListener('pointercancel', cancelHold);
window.addEventListener('blur', cancelHold);
`;
