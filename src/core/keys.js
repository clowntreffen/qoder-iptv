
export const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  OK: 13,
  BACK: 461,
  
  NUM_0: 48,
  NUM_9: 57,
  
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  
  PLAY: 415,
  PAUSE: 19,
  STOP: 413,
  FF: 417,
  RW: 412,
  PLAY_PAUSE: 10252,
  
  CH_UP: 33,
  CH_DOWN: 34,
  
  INFO: 457,
  MENU: 18
};


export function digitOf(keyCode) {
  if (keyCode >= KEY.NUM_0 && keyCode <= KEY.NUM_9) return keyCode - KEY.NUM_0;
  return null;
}
