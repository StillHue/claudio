import { c as _c } from "react-compiler-runtime";
import React from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { logEvent } from '../../services/analytics/index.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';

type RateLimitOptionsMenuProps = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay | undefined;
  } | undefined) => void;
  context: ToolUseContext & LocalJSXCommandContext;
};

function RateLimitOptionsMenu(t0) {
  const $ = _c(8);
  const {
    onDone,
  } = t0;
  const options = [{
    label: "Stop and wait for limit to reset",
    value: "cancel"
  }];
  let t1;
  if ($[0] !== onDone) {
    t1 = function handleCancel() {
      logEvent("tengu_rate_limit_options_menu_cancel", {});
      onDone(undefined, {
        display: "skip"
      });
    };
    $[0] = onDone;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleCancel = t1;
  let t2;
  if ($[2] !== handleCancel) {
    t2 = function handleSelect(value) {
      if (value === "cancel") {
        handleCancel();
      }
    };
    $[2] = handleCancel;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleSelect = t2;
  let t3;
  if ($[4] !== handleSelect || $[5] !== options) {
    t3 = <Select options={options} onChange={handleSelect} visibleOptionCount={options.length} />;
    $[4] = handleSelect;
    $[5] = options;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== handleCancel || $[8] !== t3) {
    t4 = <Dialog title="What do you want to do?" onCancel={handleCancel} color="suggestion">{t3}</Dialog>;
    $[7] = handleCancel;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  return t4;
}

export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext & LocalJSXCommandContext): Promise<React.ReactNode> {
  return <RateLimitOptionsMenu onDone={onDone} context={context} />;
}
