import { PlotPanel, sphere } from '../../src/backed';
import * as S from './studies';

const cases: [string, ReturnType<typeof S.onePerSubject>, object?, object?][] = [
  ['One value per subject', S.onePerSubject()],
  ['Group × condition, runs averaged', S.groupByCondition()],
  ['FIR time course', S.fir()],
  ['Spline / HRF basis, reconstructed', S.basis()],
  ['Covariate', S.covariate(), { x: 'age', subjects: 'points' }],
  ['Circular selection', S.groupByCondition(), undefined, { circular: true }],
];

const grid = document.getElementById('grid')!;
for (const [title, backing, spec, extra] of cases) {
  const box = document.createElement('section');
  box.className = 'case';
  box.innerHTML = `<h2>${title}</h2>`;
  grid.appendChild(box);
  const panel = new PlotPanel(backing, { width: 480, spec: spec as any, ...(extra as object) });
  box.appendChild(panel.element);
  panel.show(backing.extract(sphere(S.centre, 4)));
}
