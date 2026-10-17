<script setup lang="ts">
import { ref } from 'vue';
import { useSettings } from '../stores/settings';
import { useGame } from '../stores/game';
import { useStats } from '../stores/stats';
import { AudioManager } from '../game/audio/AudioManager';
import { detectTier } from '../utils/performance';

const props = withDefaults(defineProps<{ modal?: boolean }>(), { modal: false });
const emit = defineEmits<{ close: [] }>();
const s = useSettings();
const game = useGame();
const stats = useStats();
const confirmReset = ref(false);
const autoTier = detectTier();
const tierName = { low: '低', medium: '中', high: '高' };

function save() {
  void s.save();
}

function testSound() {
  save();
  AudioManager.play('card_pick');
}

function back() {
  save();
  if (props.modal) emit('close');
  else game.view = 'menu';
}

async function resetData() {
  await stats.resetAll();
  confirmReset.value = false;
  game.toast('战绩数据已清空', '#ff8a96');
}
</script>

<template>
  <div :class="modal ? 'settings-inner' : 'page'">
    <div class="page-header">
      <button class="icon-btn" aria-label="返回" @click="back">←</button>
      <h2>游戏设置</h2>
    </div>
    <div class="scroll">
      <section>
        <h4>音频</h4>
        <label class="row"><span>主音量 {{ Math.round(s.master * 100) }}%</span><input v-model.number="s.master" type="range" min="0" max="1" step="0.05" @change="testSound" /></label>
        <label class="row"><span>音乐 {{ Math.round(s.music * 100) }}%</span><input v-model.number="s.music" type="range" min="0" max="1" step="0.05" @change="save" /></label>
        <label class="row"><span>音效 {{ Math.round(s.sfx * 100) }}%</span><input v-model.number="s.sfx" type="range" min="0" max="1" step="0.05" @change="testSound" /></label>
      </section>
      <section>
        <h4>画面与特效</h4>
        <label class="toggle"><span>屏幕震动</span><input v-model="s.shake" type="checkbox" @change="save" /></label>
        <label class="toggle"><span>闪光效果</span><input v-model="s.flash" type="checkbox" @change="save" /></label>
        <label class="toggle"><span>伤害数字</span><input v-model="s.damageNumbers" type="checkbox" @change="save" /></label>
        <label class="toggle"><span>战斗信息播报</span><input v-model="s.showLog" type="checkbox" @change="save" /></label>
        <div class="row">
          <span>画质 / 粒子数量</span>
          <div class="tabs">
            <button v-for="q in (['auto', 'low', 'medium', 'high'] as const)" :key="q" class="tab" :class="{ active: s.quality === q }" @click="s.quality = q; save()">
              {{ q === 'auto' ? `自动（${tierName[autoTier]}）` : tierName[q] }}
            </button>
          </div>
        </div>
      </section>
      <section>
        <h4>对局</h4>
        <div class="row">
          <span>默认战斗倍速</span>
          <div class="tabs">
            <button v-for="v in [1, 2, 3]" :key="v" class="tab" :class="{ active: s.battleSpeed === v }" @click="s.battleSpeed = v; save()">{{ v }}×</button>
          </div>
        </div>
        <label class="toggle"><span>结算后自动进入下一回合</span><input v-model="s.autoNext" type="checkbox" @change="save" /></label>
      </section>
      <section v-if="!modal">
        <h4>数据</h4>
        <p class="note">存档保存在本机浏览器（IndexedDB），刷新页面后可从最近的安全存档点继续。</p>
        <button v-if="!confirmReset" class="btn danger small" @click="confirmReset = true">清空战绩与排行榜</button>
        <div v-else class="confirm">
          <span>确定清空？此操作不可撤销。</span>
          <button class="btn danger small" @click="resetData">确定</button>
          <button class="btn ghost small" @click="confirmReset = false">取消</button>
        </div>
        <button class="btn ghost small" style="margin-left: 8px" @click="s.reset()">恢复默认设置</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-inner {
  display: flex;
  flex-direction: column;
  padding: 14px;
  width: 100%;
  max-height: 90vh;
}
.scroll {
  max-width: 560px;
  width: 100%;
  margin: 0 auto;
}
section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--gold);
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 14px;
}
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  font-size: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.toggle input {
  width: 22px;
  height: 22px;
  accent-color: var(--gold);
}
.note {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}
.confirm {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  flex-wrap: wrap;
}
</style>
