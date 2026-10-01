// 승인된 조감도의 좌표를 지도 세계 좌표로 옮긴다. 이미지는 그대로 두고 상호작용 영역만 정의한다.
export const WORLD = { w: 1216, h: 800 };
export const SOURCE_SIZE = [1546, 1017];
export const MAP_IMAGE = 'assets/joseon/v2/map-concept-v1.png';
export const sourceToWorld = ([x, y]) => [x * WORLD.w / SOURCE_SIZE[0], y * WORLD.h / SOURCE_SIZE[1]];
const box = ([x, y, w, h]) => ({ img: sourceToWorld([x, y]), size: sourceToWorld([w, h]) });
const building = (bounds, entry, label) => ({ ...box(bounds), entry: sourceToWorld(entry), labelPos: sourceToWorld(label), depth: sourceToWorld(entry)[1] - 2 });

export const BUILDING_LAYOUT = {
  approval: building([535, 53, 440, 312], [680, 350], [750, 43]),
  inbox: building([83, 204, 358, 234], [355, 433], [265, 194]),
  research: building([1065, 205, 237, 228], [1092, 455], [1180, 195]),
  test: building([986, 562, 426, 272], [1048, 830], [1210, 549]),
  build: building([683, 706, 267, 218], [750, 940], [818, 694]),
  // 앞 계단의 짧은 길은 조경으로 끊겨 있다. 연결된 동쪽 흙길을 사헌부의 도착 지점으로 쓴다.
  check: building([105, 566, 257, 218], [475, 705], [229, 554]),
  rest: building([346, 751, 264, 209], [555, 942], [477, 739]),
};
export const KING_POS = sourceToWorld([679, 277]);
export const GATE = {
  ...box([608, 377, 259, 210]),
  anchor: sourceToWorld([117, 205]),
  base: sourceToWorld([725, 582]),
  // 중앙 기둥 왼쪽 열린 칸을 통과하는 동안 지붕·정면을 인물 위에 다시 얹는다. 계단 바닥은 제외한다.
  occlusion: { ...box([608, 377, 259, 181]), depth: sourceToWorld([0, 558])[1] },
};

// 좌표는 실제 흙길 중심선이다. 문 지붕 아래 가려지는 부분만 portal로 명시한다.
const corridor = (id, points, width = 12, kind = 'dirt') => ({ id, points: points.map(sourceToWorld), width: width * WORLD.w / SOURCE_SIZE[0], kind });
export const WALKABLE_CORRIDORS = [
  corridor('palace', [[680, 350], [690, 365], [700, 377], [721, 377]]),
  corridor('gate-passage', [[721, 377], [721, 590]], 16, 'portal'),
  corridor('gate-court', [[721, 590], [721, 630]], 24),
  corridor('inbox', [[355, 433], [382, 459], [388, 484], [406, 515], [405, 548], [397, 567], [435, 589]]),
  corridor('west', [[435, 589], [480, 590], [521, 601], [547, 617], [568, 633], [640, 636], [721, 630]]),
  corridor('west-fork', [[568, 633], [512, 626], [500, 655], [479, 682], [475, 705]]),
  corridor('east', [[721, 630], [820, 635], [899, 630], [958, 606]]),
  corridor('library', [[958, 606], [1030, 600], [1073, 582], [1104, 569], [1127, 565], [1140, 545], [1123, 530], [1105, 515], [1090, 497], [1090, 470], [1092, 455]]),
  corridor('test', [[958, 606], [946, 645], [953, 690], [964, 732], [973, 764], [985, 775], [1000, 785], [1020, 797], [1032, 810], [1048, 830]]),
  corridor('south', [[721, 630], [733, 680], [738, 700], [721, 734], [701, 750], [679, 775], [652, 800], [652, 833], [664, 862], [680, 890], [690, 914], [750, 940]]),
  corridor('rest', [[690, 914], [660, 910], [635, 918], [617, 930], [588, 939], [555, 942]]),
];
export const APRON_POLYGONS = [
  { id: 'gate-stairs', kind: 'stairs', points: [[705, 556], [737, 556], [737, 590], [705, 590]].map(sourceToWorld) },
];
