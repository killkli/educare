import React, { useState } from 'react';

export interface AssistantTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  badge: string;
  gradient: string;
  borderGlow: string;
  badgeColor: string;
}

const ASSISTANT_TEMPLATES: AssistantTemplate[] = [
  {
    id: 'tpl_code_coach',
    name: '程式開發導師',
    description: '專精於演算法、系統架構設計與程式碼優化，提供高品質重構指引與最佳實踐。',
    systemPrompt:
      '你是一位資深的軟體架構師與程式開發導師。你擅長以清晰、嚴謹且符合最佳實踐（Best Practices）的方式回答程式開發問題。在回覆時，請提供具體的程式碼範例、分析其時間/空間複雜度，並指出潛在的邊界狀況（Edge Cases）與重構建議。',
    icon: '💻',
    badge: '技術開發',
    gradient:
      'from-cyan-500/20 to-blue-500/5 hover:from-cyan-500/30 hover:to-blue-500/10 border-cyan-500/20',
    borderGlow:
      'group-hover:border-cyan-500/50 shadow-[0_4px_20px_-4px_rgba(6,182,212,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(6,182,212,0.25)]',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  },
  {
    id: 'tpl_copywriter',
    name: '品牌社群寫手',
    description: '擅長撰寫具有高點閱率與轉換率的社群貼文、廣告文案與高質量部落格文章。',
    systemPrompt:
      '你是一位頂尖的內容行銷大師與品牌寫手。你擅長撰寫引人入勝、具有高點閱率與轉換率的社群媒體貼文、廣告文案和部落格文章。請根據用戶提供的產品、受眾和語氣需求，靈活變換文風，並善用標題、表情符號（Emoji）以及清晰的行動呼籲（Call to Action）來提升內容吸引力。',
    icon: '✍️',
    badge: '內容行銷',
    gradient:
      'from-purple-500/20 to-pink-500/5 hover:from-purple-500/30 hover:to-pink-500/10 border-purple-500/20',
    borderGlow:
      'group-hover:border-purple-500/50 shadow-[0_4px_20px_-4px_rgba(168,85,247,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(168,85,247,0.25)]',
    badgeColor: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  },
  {
    id: 'tpl_english_tutor',
    name: '英文口說寫作助教',
    description: '修正文法錯誤、潤飾句子使其地道，並能用流暢的中英雙語進行對話與教學。',
    systemPrompt:
      '你是一位 Patience 且專業的英文學習伴侶。你擅長修正英文語法錯誤、潤飾句子使其更加道地（idiomatic），並能用清晰易懂的方式解釋文法觀念與詞彙差異。當用戶用英文與你對話時，請提供友善的回饋，並在必要時以繁體中文輔助說明。',
    icon: '📖',
    badge: '語言學習',
    gradient:
      'from-amber-500/20 to-orange-500/5 hover:from-amber-500/30 hover:to-orange-500/10 border-amber-500/20',
    borderGlow:
      'group-hover:border-amber-500/50 shadow-[0_4px_20px_-4px_rgba(245,158,11,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(245,158,11,0.25)]',
    badgeColor: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  },
  {
    id: 'tpl_data_analyst',
    name: '商業數據分析師',
    description: '解析複雜數據、提煉核心指標與痛點，並以結構化 Markdown 呈現關鍵洞察。',
    systemPrompt:
      '你是一位資深的商業數據分析師。你擅長將複雜數據轉化為易懂的商業洞察。你擁有極佳的邏輯推理能力，並能運用 Markdown 表格或文字圖表結構化呈現分析結果。在回答時，請強調核心指標、關鍵痛點（Pain Points），並提出具體且可執行的優化建議。',
    icon: '📊',
    badge: '數據決策',
    gradient:
      'from-emerald-500/20 to-teal-500/5 hover:from-emerald-500/30 hover:to-teal-500/10 border-emerald-500/20',
    borderGlow:
      'group-hover:border-emerald-500/50 shadow-[0_4px_20px_-4px_rgba(16,185,129,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(16,185,129,0.25)]',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  },
];

interface TemplateSelectorProps {
  onSelectTemplate: (template: AssistantTemplate) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onSelectTemplate }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeTemplate = ASSISTANT_TEMPLATES.find(t => t.id === selectedId);

  return (
    <div className='mb-8 bg-gray-900/40 backdrop-blur-md border border-gray-700/40 rounded-2xl p-6 shadow-xl'>
      <div className='flex items-center justify-between mb-4'>
        <div>
          <h3 className='text-lg font-bold text-white flex items-center gap-2'>
            <span>💡 選擇預設助理樣板</span>
            <span className='px-2 py-0.5 text-xs font-normal text-cyan-400 bg-cyan-950/50 border border-cyan-800/40 rounded-full'>
              推薦
            </span>
          </h3>
          <p className='text-xs text-gray-400 mt-1'>
            一鍵載入專業的角色設定，省去手動撰寫系統提示詞的繁瑣步驟。
          </p>
        </div>
      </div>

      {/* Grid Layout */}
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
        {ASSISTANT_TEMPLATES.map(template => {
          const isSelected = selectedId === template.id;
          return (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`group relative text-left flex flex-col justify-between p-5 rounded-xl border-2 bg-gradient-to-br ${template.gradient} ${template.borderGlow} transition-all duration-300 cursor-pointer transform hover:-translate-y-1 ${
                isSelected
                  ? 'border-cyan-500 bg-gray-800/80 scale-[1.01]'
                  : 'border-gray-700/40 bg-gray-800/40 hover:border-gray-600/50'
              }`}
            >
              <div>
                <div className='flex items-center justify-between mb-3'>
                  <span className='text-3xl filter drop-shadow-md transform group-hover:scale-110 transition-transform duration-200'>
                    {template.icon}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-md font-semibold tracking-wider ${template.badgeColor}`}
                  >
                    {template.badge}
                  </span>
                </div>
                <h4 className='text-sm font-bold text-white mb-1 group-hover:text-cyan-300 transition-colors duration-200'>
                  {template.name}
                </h4>
                <p className='text-xs text-gray-400 line-clamp-3 leading-relaxed'>
                  {template.description}
                </p>
              </div>
              <div className='mt-4 flex items-center justify-end'>
                <span
                  className={`text-xs font-semibold px-3 py-1 rounded-lg transition-all duration-200 ${
                    isSelected
                      ? 'bg-cyan-500 text-white'
                      : 'bg-gray-700/60 text-gray-300 group-hover:bg-gray-700 group-hover:text-white'
                  }`}
                >
                  {isSelected ? '已選取' : '檢視樣板'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Preview Section */}
      {activeTemplate && (
        <div className='bg-gray-950/60 border border-gray-800/80 rounded-xl p-5 animate-fadeIn transition-all duration-300'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3 pb-3 border-b border-gray-800/60'>
            <div>
              <span className='text-xs text-gray-500 uppercase font-bold tracking-wider'>
                樣板預覽
              </span>
              <h4 className='text-base font-bold text-cyan-400 flex items-center gap-1.5 mt-0.5'>
                <span>{activeTemplate.icon}</span>
                <span>{activeTemplate.name}</span>
              </h4>
            </div>
            <button
              onClick={() => onSelectTemplate(activeTemplate)}
              className='px-5 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white text-xs font-bold rounded-lg transition-all duration-200 transform hover:scale-[1.02] shadow-md shadow-cyan-950/40 cursor-pointer'
            >
              ⚡ 套用此樣板
            </button>
          </div>
          <div className='space-y-3'>
            <div>
              <span className='block text-xs font-semibold text-gray-400 mb-1'>
                系統提示詞 (System Prompt)
              </span>
              <div className='bg-gray-900/80 rounded-lg p-3 text-xs text-gray-300 font-mono leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap select-all border border-gray-850'>
                {activeTemplate.systemPrompt}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
