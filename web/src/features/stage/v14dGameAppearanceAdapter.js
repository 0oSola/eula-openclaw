const PREPARATION_STATUS = Object.freeze({
  pipeline: "v14d-game",
  phase: "preparation",
  realAppearanceAvailable: false,
  label: "接入准备：真实游戏外观未迁移",
});

export function createV14dGameAppearanceAdapter() {
  let installedModel = null;

  function getStatus() {
    return {
      ...PREPARATION_STATUS,
      installed: installedModel !== null,
    };
  }

  return {
    getStatus,
    install({ model } = {}) {
      installedModel = model || null;
      return getStatus();
    },
    release() {
      installedModel = null;
      return getStatus();
    },
  };
}
