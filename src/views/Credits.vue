<script setup lang="ts">
import { computed } from 'vue';
import { useGame } from '../stores/game';
import { getManifest } from '../game/data/AssetManager';

const game = useGame();
const credits = computed(() => getManifest()?.credits ?? []);
</script>

<template>
  <div class="page">
    <div class="page-header">
      <button class="icon-btn" aria-label="返回" @click="game.view = 'menu'">←</button>
      <h2>制作人员与素材授权</h2>
    </div>
    <div class="scroll">
      <section>
        <h4>《一线决战》</h4>
        <p>策略抽卡 · 自走棋 · 自动战斗 · Roguelike</p>
        <p class="muted">技术栈：Vue 3 · TypeScript · PixiJS 8 · GSAP · Howler.js · Pinia · IndexedDB · Vite</p>
      </section>
      <section>
        <h4>第三方素材</h4>
        <p class="muted">
          所有素材在开发阶段下载、审核并保存在游戏本地静态资源目录，游戏运行时不访问任何第三方素材服务器。
          下列素材均采用 CC0 1.0（公共领域）授权，可自由使用；署名以示感谢。
        </p>
        <div v-if="!credits.length" class="muted">素材清单未加载，游戏使用程序化图形兜底。</div>
        <div v-for="c in credits" :key="c.id" class="credit">
          <div class="cn">{{ c.id }} <span class="chip">{{ c.license }}</span></div>
          <div class="cm">作者：{{ c.author }} · 用途：{{ c.usage }}</div>
          <div class="cm url">{{ c.page }}</div>
        </div>
      </section>
      <section>
        <h4>程序化素材</h4>
        <p class="muted">投射物、冰晶、战场背景拼接、闪电/光束/冲击波/法阵等技能特效由脚本或 PixiJS 运行时程序化生成。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
h4 {
  margin: 0 0 8px;
  color: var(--gold);
}
p {
  margin: 4px 0;
  font-size: 14px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.credit {
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.cn {
  font-weight: 800;
  display: flex;
  gap: 6px;
  align-items: center;
}
.cm {
  font-size: 12px;
  color: #c9cfee;
}
.url {
  color: var(--muted);
  word-break: break-all;
  user-select: text;
  -webkit-user-select: text;
}
</style>
