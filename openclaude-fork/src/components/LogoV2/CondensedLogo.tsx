import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { BRAND_NAME, BRAND_TAGLINE } from '../../constants/brand.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getEffortSuffix } from '../../utils/effort.js';
import { truncate } from '../../utils/format.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { formatModelAndBilling, getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js';
import { renderModelSetting } from '../../utils/model/model.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { AnimatedClawd } from './AnimatedClawd.js';
import { Clawd } from './Clawd.js';
export function CondensedLogo() {
  const $ = _c(23);
  const {
    columns
  } = useTerminalSize();
  const agent = useAppState(_temp);
  const effortValue = useAppState(_temp2);
  const model = useMainLoopModel();
  const modelDisplayName = renderModelSetting(model);
  const {
    version,
    cwd,
    billingType,
    agentName: agentNameFromSettings
  } = getLogoDisplayData();
  const agentName = agent ?? agentNameFromSettings;
  const textWidth = Math.max(columns - 15, 20);
  const truncatedVersion = truncate(version, Math.max(textWidth - 13, 6));
  const effortSuffix = getEffortSuffix(model, effortValue);
  const {
    shouldSplit,
    truncatedModel,
    truncatedBilling
  } = formatModelAndBilling(modelDisplayName + effortSuffix, billingType, textWidth);
  const cwdAvailableWidth = agentName ? textWidth - 1 - stringWidth(agentName) - 3 : textWidth;
  const truncatedCwd = truncatePath(cwd, Math.max(cwdAvailableWidth, 10));
  let t4;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = isFullscreenEnvEnabled() ? <AnimatedClawd /> : <Clawd />;
    $[0] = t4;
  } else {
    t4 = $[0];
  }
  let t5;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text bold={true} color="brand">{BRAND_NAME}</Text>;
    $[1] = t5;
  } else {
    t5 = $[1];
  }
  let t6;
  if ($[2] !== truncatedVersion) {
    t6 = <Text>{t5} <Text dimColor={true}>v{truncatedVersion}</Text></Text>;
    $[2] = truncatedVersion;
    $[3] = t6;
  } else {
    t6 = $[3];
  }
  const t6a = BRAND_TAGLINE;
  let t7;
  if ($[4] !== shouldSplit || $[5] !== truncatedBilling || $[6] !== truncatedModel) {
    t7 = shouldSplit ? <><Text><Text color="inactive">Model</Text><Text dimColor={true}>  {truncatedModel}</Text></Text><Text><Text color="inactive">Mode</Text><Text dimColor={true}>   {truncatedBilling}</Text></Text></> : <Text><Text color="inactive">Model</Text><Text dimColor={true}>  {truncatedModel} · {truncatedBilling}</Text></Text>;
    $[4] = shouldSplit;
    $[5] = truncatedBilling;
    $[6] = truncatedModel;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  const t8 = agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd;
  let t9;
  if ($[8] !== t8) {
    t9 = <Text><Text color="inactive">Path</Text><Text dimColor={true}>   {t8}</Text></Text>;
    $[8] = t8;
    $[9] = t9;
  } else {
    t9 = $[9];
  }
  let t12;
  if ($[10] !== t6 || $[11] !== t7 || $[12] !== t9) {
    t12 = <OffscreenFreeze><Box borderStyle="round" borderColor="inactive" paddingX={2} paddingY={0} flexDirection="row" gap={2} alignItems="center"><Box flexDirection="column" alignItems="center"><Text color="inactive">•</Text>{t4}<Text color="inactive">•</Text></Box><Box flexDirection="column">{t6}<Text dimColor={true}>{t6a}</Text><Box marginTop={1} flexDirection="column">{t7}{t9}</Box></Box></Box></OffscreenFreeze>;
    $[10] = t6;
    $[11] = t7;
    $[12] = t9;
    $[13] = t12;
  } else {
    t12 = $[13];
  }
  return t12;
}
function _temp2(s_0) {
  return s_0.effortValue;
}
function _temp(s) {
  return s.agent;
}
