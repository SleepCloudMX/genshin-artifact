import './styles.css';
import { mount } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('找不到 #app 挂载点');
mount(root);
