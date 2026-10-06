import './styles.css';
import { mount } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('找不到 #app 挂载点');

// 清掉 index.html 里的启动占位（「正在加载…」/「脚本没能加载」）与兜底计时器
root.replaceChildren();
root.dataset['mounted'] = '1';
mount(root);
