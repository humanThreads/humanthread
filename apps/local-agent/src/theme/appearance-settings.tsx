import { Moon, PanelRight, Sun } from "lucide-react";

import { APPEARANCES, type Appearance } from "./appearance";
import { useAppearance } from "./theme-provider";

const OPTIONS: Record<Appearance, {
  label: string;
  description: string;
  Icon: typeof Sun;
}> = {
  light: {
    label: "统一浅色",
    description: "产品与执行区域使用一致的浅色表面。",
    Icon: Sun,
  },
  hybrid: {
    label: "混合模式",
    description: "深色导航搭配浅色工作区。",
    Icon: PanelRight,
  },
  dark: {
    label: "全局深色",
    description: "所有工作区与执行表面统一使用深色。",
    Icon: Moon,
  },
};

export function AppearanceSettings() {
  const { appearance, setAppearance } = useAppearance();

  return (
    <fieldset className="appearance-settings">
      <legend>外观</legend>
      <div className="appearance-options">
        {APPEARANCES.map((value) => {
          const option = OPTIONS[value];
          return (
            <label className="appearance-option" data-selected={appearance === value} key={value}>
              <input
                aria-label={option.label}
                checked={appearance === value}
                name="appearance"
                onChange={() => setAppearance(value)}
                type="radio"
                value={value}
              />
              <span className={`appearance-swatch appearance-swatch-${value}`} aria-hidden="true">
                <span />
                <span />
              </span>
              <span className="appearance-option-copy">
                <span className="appearance-option-title">
                  <option.Icon aria-hidden="true" size={16} />
                  {option.label}
                </span>
                <span>{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
