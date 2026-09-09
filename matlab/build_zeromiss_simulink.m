function build_zeromiss_simulink()
% BUILD_ZEROMISS_SIMULINK  Programmatically build + run a Simulink model of the planar
% TPN engagement and print "name,miss" CSV — the Simulink leg of the V&V.
% Run from the repo's matlab/ folder in MATLAB:
%
%     >> cd <repo>/matlab
%     >> build_zeromiss_simulink
%
% It creates zeromiss_engagement.slx (a vector Integrator fed by the guidance
% derivative block, solved with the fixed-step RK4 solver ode4 at dt = 1e-3) and
% reports the miss distance for the same canonical cases the Octave/C++ checks use,
% so all four implementations can be compared head-to-head.

  global ZM_P
  model = 'zeromiss_engagement';
  if bdIsLoaded(model); close_system(model, 0); end
  new_system(model);
  load_system(model);

  % --- blocks: Integrator(6) <- Interpreted MATLAB Function(zeromiss_deriv) ---
  add_block('simulink/Continuous/Integrator', [model '/State'], ...
            'Position', [400 100 460 160]);
  set_param([model '/State'], 'InitialConditionSource', 'external');

  add_block('simulink/User-Defined Functions/Interpreted MATLAB Function', ...
            [model '/Deriv'], 'Position', [220 100 320 160], ...
            'MATLABFcn', 'zeromiss_deriv', 'OutputDimensions', '6');

  add_block('simulink/Sources/Constant', [model '/X0'], ...
            'Position', [220 200 320 240], 'Value', 'X0');

  add_block('simulink/Sinks/To Workspace', [model '/Out'], ...
            'Position', [560 100 640 160], 'VariableName', 'xout', ...
            'SaveFormat', 'Array', 'SampleTime', '-1');

  % wiring: State -> Deriv -> State ; X0 -> State(IC) ; State -> Out
  add_line(model, 'State/1', 'Deriv/1', 'autorouting', 'on');
  add_line(model, 'Deriv/1', 'State/1', 'autorouting', 'on');
  add_line(model, 'X0/1', 'State/2', 'autorouting', 'on');
  add_line(model, 'State/1', 'Out/1', 'autorouting', 'on');

  % --- fixed-step RK4 (ode4) at 1 kHz, to match the Python engine ---
  dt = 1e-3;
  set_param(model, 'Solver', 'ode4', 'SolverType', 'Fixed-step', 'FixedStep', num2str(dt));

  % --- canonical cases (identical to tools/matlab + native + Python) ---
  D2R = pi/180;
  cases = {
    % name           VM    gMdeg  xT    yT     VT    gTdeg  N    tF
    'headon_offset', 1000, 0,     8000, 600,   300,  195,   4,   12;
    'crossing',      1000, 10,    7000, 1500,  350,  200,   4,   12;
    'tail_high_N',   1000, 0,     9000, -400,  300,  185,   5,   12;
  };

  for k = 1:size(cases,1)
    name = cases{k,1};
    VM = cases{k,2}; gMd = cases{k,3};
    xT = cases{k,4}; yT = cases{k,5}; VT = cases{k,6}; gTd = cases{k,7};
    Nnav = cases{k,8}; tF = cases{k,9};

    ZM_P = struct('VM', VM, 'VT', VT, 'N', Nnav);
    X0 = [0; 0; gMd*D2R; xT; yT; gTd*D2R];
    assignin('base','X0', X0);

    set_param(model, 'StopTime', num2str(tF));
    so = sim(model, 'SaveOutput','on');
    x = so.get('xout');                                  % N-by-6 trajectory

    R = hypot(x(:,4)-x(:,1), x(:,5)-x(:,2));
    [~, i] = min(R);
    if i > 1 && i < numel(R)                             % parabolic closest-approach refine
      R0 = R(i-1); R1 = R(i); R2 = R(i+1);
      den = R0 - 2*R1 + R2;
      if abs(den) > 1e-12
        xv = max(-1, min(1, 0.5*(R0 - R2)/den));
        miss = max(R1 + 0.5*(R2-R0)*xv + 0.5*den*xv*xv, 0);
      else
        miss = R1;
      end
    else
      miss = R(i);
    end
    fprintf('%s,%.6f\n', name, miss);
  end

  % always save the .slx next to this script, regardless of the caller's cwd
  here = fileparts(mfilename('fullpath'));
  save_system(model, fullfile(here, [model '.slx']));
  fprintf('saved %s.slx\n', model);
end
