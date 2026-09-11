import { useState } from "react";
import { Icon } from "../ui/Icon";
import styles from "./Sample.module.css";

const swatches = [
  { name: "暖白画布", color: "#fffefa" },
  { name: "浅砂底色", color: "#faf3ea" },
  { name: "陶土强调", color: "#bb8663" },
  { name: "深棕操作", color: "#805536" },
];

export default function DesignSample(): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("仅演示视觉与本地交互，不连接 Agent。");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>SKILLWORLD <span>/ DESIGN STUDY 01</span></span>
        <span className={styles.badge}>视觉样板 · 开发预览</span>
      </header>
      <section className={styles.intro} aria-labelledby="sample-title">
        <p className={styles.eyebrow}>山丘远征站 / 最小视觉基础</p>
        <h1 id="sample-title">留一点空间，<br />让理解慢慢发生。</h1>
        <p>暖白的纸面，克制的陶土色。一套为阅读与探索准备的界面语言。</p>
      </section>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="basics-title">
          <div className={styles.sectionTitle}><span>01 / FOUNDATIONS</span><h2 id="basics-title">颜色与操作</h2></div>
          <div className={styles.swatches}>{swatches.map((swatch) => (
            <div key={swatch.color}><div className={styles.paint} style={{ background: swatch.color }} />
              <strong>{swatch.name}</strong><small>{swatch.color}</small></div>
          ))}</div>
          <div className={styles.rule} />
          <div className={styles.row}>
            <button className={styles.primary} onClick={() => setNotice("已体验主按钮反馈；未启动学习或发送请求。")}>开始探索 <Icon name="arrow" /></button>
            <button className={styles.secondary} onClick={() => { setDraft(""); setNotice("样板已重置，输入草稿已清空。"); }}>重置样板</button>
            <button className={styles.secondary} disabled>暂不可用</button>
          </div>
          <p className={styles.notice} role="status">{notice}</p>
          <div className={styles.row}><span className={styles.badge}>教材 · 示例</span><span className={styles.outlineBadge}>能力未验证</span></div>
          <div className={styles.iconSamples}>
            <span><Icon name="book" /> 手册</span><span><Icon name="guide" /> 向导</span><span><Icon name="arrow" /> 前往</span>
            <span><Icon name="brain" /> 思考</span><span><Icon name="tool" /> 工具</span>
            <span><span className={styles.spinning}><Icon name="loader" /></span> 进行中</span>
            <span><Icon name="check" /> 成功</span><span><Icon name="close" /> 失败</span><span><Icon name="chevron" /> 展开</span>
            <small>自绘 SVG / 统一描边 / 颜色继承文字</small>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="reading-title">
          <div className={styles.sectionTitle}><span>02 / READING & CONVERSATION</span><h2 id="reading-title">阅读与对话</h2></div>
          <div className={styles.reading}>
            <span className={styles.readingLabel}><Icon name="book" /> 教材节选 · 演示内容</span>
            <h3>等待的时候，也可以向前走。</h3>
            <p>想象一支在山间扎营的小队：有人烧水，有人搭帐篷。等待水开的时间，不必让整支队伍停下来。</p>
          </div>
          <div className={styles.messages} aria-label="静态对话样例">
            <p className={styles.userMessage}>所以，等待时可以把机会交给其他任务？</p>
            <div className={styles.guideMessage}><span><Icon name="guide" /> 随行向导 · 示例</span><p>正是如此。先理解任务如何协作，再去观察它们的执行顺序。</p></div>
          </div>
          <label className={styles.inputLabel} htmlFor="sample-draft">对话草稿</label>
          <div className={styles.composer}>
            <textarea id="sample-draft" value={draft} onChange={(event) => setDraft(event.target.value)}
              placeholder="写下一个问题，或一次新发现……" maxLength={500} aria-describedby="draft-help" />
            <div><small id="draft-help">仅本地草稿 · {draft.length}/500</small><button className={styles.primary} disabled>发送 <Icon name="arrow" /></button></div>
          </div>
        </section>
      </div>
      <footer className={styles.footer}><span>视觉验证，不代表真实学习进度。</span><span>地图地形后续采用 3D 建模，本页不包含地图资产。</span></footer>
    </main>
  );
}
