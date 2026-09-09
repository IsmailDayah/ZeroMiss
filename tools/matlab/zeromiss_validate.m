% zeromiss_validate.m — MATLAB/Octave cross-check driver.
% Runs in BOTH GNU Octave and MATLAB. Prints "name,miss" CSV so the Python harness can
% diff it against the core, making V&V four-language (Python <-> TS <-> MATLAB/Octave <-> C++).
%
% Usage:  octave-cli --no-gui --quiet tools/matlab/zeromiss_validate.m
%   (or)  matlab -batch "run('tools/matlab/zeromiss_validate.m')"

addpath(fileparts(mfilename('fullpath')));  % find run_tpn_cv.m alongside this script

cases = {
  'headon_offset', 0,0,1000,0,    8000,600,300,195, 4;
  'crossing',      0,0,1000,10,   7000,1500,350,200, 4;
  'tail_high_N',   0,0,1000,0,    9000,-400,300,185, 5;
};

for k = 1:size(cases, 1)
  c = cases(k, :);
  miss = run_tpn_cv(c{2}, c{3}, c{4}, c{5}, c{6}, c{7}, c{8}, c{9}, c{10}, 0.001, 15.0);
  fprintf('%s,%.6f\n', c{1}, miss);
end
