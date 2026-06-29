import React, { useState } from 'react';
import { providerManager } from '../../services/providerRegistry';
import { ProviderType, ProviderSettings as IProviderSettings } from '../../services/llmAdapter';

interface ProviderSettingsProps {
  onClose?: () => void;
}

interface ProviderInfo {
  name: string;
  description: string;
  icon: string;
  color: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  helpUrl: string;
}

const ProviderSettings: React.FC<ProviderSettingsProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<IProviderSettings>(providerManager.getSettings());
  const [expandedProvider, setExpandedProvider] = useState<ProviderType | null>(null);
  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<ProviderType, string[]>>(
    {} as Record<ProviderType, string[]>,
  );
  const [fetchingModels, setFetchingModels] = useState<Record<ProviderType, boolean>>(
    {} as Record<ProviderType, boolean>,
  );
  const [useCustomModel, setUseCustomModel] = useState<Record<ProviderType, boolean>>(
    {} as Record<ProviderType, boolean>,
  );

  const providerInfo: Record<ProviderType, ProviderInfo> = {
    gemini: {
      name: 'Google Gemini',
      description: '高品質的 AI 助手，適合日常對話和創作',
      icon: '🧠',
      color: 'from-blue-500 to-cyan-500',
      apiKeyLabel: 'Gemini API Key',
      apiKeyPlaceholder: '請輸入您的 Google AI Studio API Key',
      helpUrl: 'https://aistudio.google.com/app/apikey',
    },
    openai: {
      name: 'OpenAI',
      description: '強大的 GPT 模型，擅長複雜推理和代碼生成',
      icon: '🤖',
      color: 'from-green-500 to-teal-500',
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: '請輸入您的 OpenAI API Key (sk-...)',
      helpUrl: 'https://platform.openai.com/api-keys',
    },
    anthropic: {
      name: 'Anthropic Claude',
      description: 'Claude 模型，支援原生工具呼叫與長上下文推理',
      icon: '🟣',
      color: 'from-violet-500 to-fuchsia-500',
      apiKeyLabel: 'Anthropic API Key',
      apiKeyPlaceholder: '請輸入您的 Anthropic API Key',
      helpUrl: 'https://console.anthropic.com/settings/keys',
    },
    ollama: {
      name: 'Ollama (本地模型)',
      description: '在您的電腦上運行的開源模型，完全私密',
      icon: '🏠',
      color: 'from-orange-500 to-red-500',
      apiKeyLabel: '服務地址',
      apiKeyPlaceholder: 'http://localhost:11434',
      helpUrl: 'https://ollama.ai/',
    },
    groq: {
      name: 'Groq',
      description: '超快速推理的 AI 模型，響應迅速',
      icon: '⚡',
      color: 'from-yellow-500 to-orange-500',
      apiKeyLabel: 'Groq API Key',
      apiKeyPlaceholder: '請輸入您的 Groq API Key',
      helpUrl: 'https://console.groq.com/keys',
    },
    openrouter: {
      name: 'OpenRouter',
      description: '統一的 AI 模型路由服務，支持多種前沿模型',
      icon: '🚀',
      color: 'from-pink-500 to-rose-500',
      apiKeyLabel: 'OpenRouter API Key',
      apiKeyPlaceholder: '請輸入您的 OpenRouter API Key',
      helpUrl: 'https://openrouter.ai/keys',
    },
    lmstudio: {
      name: 'LM Studio',
      description: '本地 OpenAI 兼容 API，支持各種開源模型',
      icon: '🖥️',
      color: 'from-emerald-500 to-green-500',
      apiKeyLabel: '服務地址',
      apiKeyPlaceholder: 'http://localhost:1234/v1',
      helpUrl: 'https://lmstudio.ai/',
    },
  };

  const handleProviderToggle = (providerType: ProviderType) => {
    const wasEnabled = settings.providers[providerType].enabled;
    providerManager.enableProvider(providerType, !wasEnabled);
    setSettings(providerManager.getSettings());

    // If we're disabling a provider that was expanded, collapse it
    if (wasEnabled && expandedProvider === providerType) {
      setExpandedProvider(null);
    }
  };

  const handleActiveProviderChange = (providerType: ProviderType) => {
    providerManager.setActiveProvider(providerType);
    setSettings(providerManager.getSettings());
  };

  const handleConfigUpdate = (providerType: ProviderType, key: string, value: string | number) => {
    providerManager.updateProviderConfig(providerType, { [key]: value });
    setSettings(providerManager.getSettings());
  };

  const testProvider = async (providerType: ProviderType) => {
    setTestingProvider(providerType);
    try {
      const provider = providerManager.getProvider(providerType);
      if (!provider) {
        alert('Provider not found');
        return;
      }

      // Test with a simple message
      const testParams = {
        systemPrompt: 'You are a helpful assistant.',
        history: [],
        message: 'Hello! Can you respond with "Test successful" if you receive this message?',
      };

      let responseReceived = false;
      for await (const chunk of provider.streamChat(testParams)) {
        if (chunk.text && chunk.text.trim()) {
          responseReceived = true;
          break;
        }
      }

      if (responseReceived) {
        alert(`✅ ${providerInfo[providerType].name} 連接測試成功！`);
      } else {
        alert(`❌ ${providerInfo[providerType].name} 測試失敗：未收到回應`);
      }
    } catch (error) {
      alert(
        `❌ ${providerInfo[providerType].name} 測試失敗：${error instanceof Error ? error.message : '未知錯誤'}`,
      );
    } finally {
      setTestingProvider(null);
    }
  };

  const fetchAvailableModels = async (providerType: ProviderType) => {
    setFetchingModels(prev => ({ ...prev, [providerType]: true }));
    try {
      const provider = providerManager.getProvider(providerType);
      if (provider && provider.getAvailableModels) {
        const models = await provider.getAvailableModels();
        setAvailableModels(prev => ({ ...prev, [providerType]: models }));
      } else {
        console.warn(`Provider ${providerType} does not support dynamic model fetching`);
      }
    } catch (error) {
      console.warn(`Failed to fetch models for ${providerType}:`, error);
      alert(`無法獲取 ${providerInfo[providerType].name} 的模型列表，請確認配置正確`);
    } finally {
      setFetchingModels(prev => ({ ...prev, [providerType]: false }));
    }
  };

  const getProviderStatus = (providerType: ProviderType) => {
    const provider = providerManager.getProvider(providerType);
    if (!provider) {
      return { status: 'error', text: '未找到' };
    }

    const enabled = settings.providers[providerType].enabled;
    const available = provider.isAvailable();

    if (!enabled) {
      return { status: 'disabled', text: '已停用' };
    }
    if (available) {
      return { status: 'ready', text: '就緒' };
    }
    if (providerType === 'ollama' || providerType === 'lmstudio') {
      return { status: 'warning', text: '服務未運行' };
    }
    return { status: 'warning', text: '需要配置' };
  };

  return (
    <div className='max-w-4xl mx-auto p-6'>
      <div className='flex items-center justify-between mb-8'>
        <div>
          <h2 className='text-3xl font-bold text-white mb-2'>AI 服務商設定</h2>
          <p className='text-gray-400'>配置和管理不同的 AI 服務商，包括本地模型</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className='p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors'
          >
            <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        )}
      </div>

      {/* Active Provider Selection */}
      <div className='mb-8 bg-gray-800/50 rounded-xl p-6 border border-gray-700/30'>
        <h3 className='text-xl font-semibold text-white mb-4 flex items-center'>
          <span className='mr-2'>🎯</span>
          當前使用的服務商
        </h3>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
          {Object.entries(providerInfo).map(([key, info]) => {
            const providerType = key as ProviderType;
            const isActive = settings.activeProvider === providerType;
            const isEnabled = settings.providers[providerType].enabled;
            const status = getProviderStatus(providerType);

            return (
              <div
                key={providerType}
                className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                  isActive
                    ? `border-cyan-500 bg-gradient-to-r ${info.color} bg-opacity-20`
                    : isEnabled && status.status === 'ready'
                      ? 'border-gray-600 bg-gray-700/30 hover:border-gray-500'
                      : 'border-gray-700 bg-gray-800/30 opacity-50 cursor-not-allowed'
                }`}
                onClick={() => {
                  if (isEnabled && status.status === 'ready') {
                    handleActiveProviderChange(providerType);
                  }
                }}
              >
                <div className='flex items-center justify-between mb-2'>
                  <div className='flex items-center'>
                    <span className='text-2xl mr-3'>{info.icon}</span>
                    <span className='font-semibold text-white'>{info.name}</span>
                  </div>
                  {isActive && (
                    <span className='text-xs bg-cyan-500 text-white px-2 py-1 rounded-full'>
                      使用中
                    </span>
                  )}
                </div>
                <div className='flex items-center justify-between'>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      status.status === 'ready'
                        ? 'bg-green-500/20 text-green-400'
                        : status.status === 'warning'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : status.status === 'disabled'
                            ? 'bg-gray-500/20 text-gray-400'
                            : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {status.text}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Provider Configuration */}
      <div className='space-y-4'>
        <h3 className='text-xl font-semibold text-white mb-4 flex items-center'>
          <span className='mr-2'>⚙️</span>
          服務商配置
        </h3>

        {Object.entries(providerInfo).map(([key, info]) => {
          const providerType = key as ProviderType;
          const provider = providerManager.getProvider(providerType);
          const isExpanded = expandedProvider === providerType;
          const isEnabled = settings.providers[providerType].enabled;
          const config = settings.providers[providerType].config;
          const status = getProviderStatus(providerType);

          return (
            <div key={providerType} className='bg-gray-800/50 rounded-xl border border-gray-700/30'>
              <div
                className='p-6 cursor-pointer'
                onClick={() => setExpandedProvider(isExpanded ? null : providerType)}
              >
                <div className='flex items-center justify-between'>
                  <div className='flex items-center'>
                    <span className='text-3xl mr-4'>{info.icon}</span>
                    <div>
                      <h4 className='text-lg font-semibold text-white'>{info.name}</h4>
                      <p className='text-gray-400 text-sm'>{info.description}</p>
                    </div>
                  </div>
                  <div className='flex items-center space-x-4'>
                    <span
                      className={`text-xs px-3 py-1 rounded-full ${
                        status.status === 'ready'
                          ? 'bg-green-500/20 text-green-400'
                          : status.status === 'warning'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : status.status === 'disabled'
                              ? 'bg-gray-500/20 text-gray-400'
                              : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {status.text}
                    </span>
                    <label className='flex items-center cursor-pointer'>
                      <input
                        type='checkbox'
                        checked={isEnabled}
                        onChange={e => {
                          e.stopPropagation();
                          handleProviderToggle(providerType);
                        }}
                        className='sr-only'
                      />
                      <div
                        className={`relative w-11 h-6 rounded-full transition-colors ${
                          isEnabled ? 'bg-cyan-500' : 'bg-gray-600'
                        }`}
                      >
                        <div
                          className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </div>
                    </label>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M19 9l-7 7-7-7'
                      />
                    </svg>
                  </div>
                </div>
              </div>

              {isExpanded && isEnabled && (
                <div className='px-6 pb-6 border-t border-gray-700/30 transition-all duration-200 ease-in-out'>
                  <div className='pt-6 space-y-4'>
                    {/* API Key / Base URL */}
                    {providerType === 'lmstudio' ? (
                      <div className='space-y-4'>
                        <div>
                          <label className='block text-sm font-medium text-gray-300 mb-2'>
                            LM Studio Base URL
                          </label>
                          <div className='flex space-x-2'>
                            <input
                              type='url'
                              value={config.baseUrl || ''}
                              onChange={e =>
                                handleConfigUpdate(providerType, 'baseUrl', e.target.value)
                              }
                              placeholder='http://localhost:1234/v1'
                              className='flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
                            />
                            <a
                              href={info.helpUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-gray-300 hover:text-white transition-colors'
                              title='開啟 LM Studio 文件'
                            >
                              <svg
                                className='w-5 h-5'
                                fill='none'
                                stroke='currentColor'
                                viewBox='0 0 24 24'
                              >
                                <path
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                  strokeWidth={2}
                                  d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                                />
                              </svg>
                            </a>
                          </div>
                        </div>
                        <div>
                          <label className='block text-sm font-medium text-gray-300 mb-2'>
                            LM Studio API Key（選填）
                          </label>
                          <input
                            type='password'
                            value={config.apiKey || ''}
                            onChange={e =>
                              handleConfigUpdate(providerType, 'apiKey', e.target.value)
                            }
                            placeholder='若您的 LM Studio 端點需要 Bearer Token，請在此輸入'
                            className='w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
                          />
                          <p className='text-xs text-gray-400 mt-1'>
                            留空時不會傳送 Authorization header。
                          </p>
                        </div>
                      </div>
                    ) : provider?.requiresApiKey || providerType === 'ollama' ? (
                      <div>
                        <label className='block text-sm font-medium text-gray-300 mb-2'>
                          {info.apiKeyLabel}
                        </label>
                        <div className='flex space-x-2'>
                          <input
                            type={providerType === 'ollama' ? 'url' : 'password'}
                            value={
                              providerType === 'ollama' ? config.baseUrl || '' : config.apiKey || ''
                            }
                            onChange={e =>
                              handleConfigUpdate(
                                providerType,
                                providerType === 'ollama' ? 'baseUrl' : 'apiKey',
                                e.target.value,
                              )
                            }
                            placeholder={info.apiKeyPlaceholder}
                            className='flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
                          />
                          <a
                            href={info.helpUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-gray-300 hover:text-white transition-colors'
                            title='獲取 API Key'
                          >
                            <svg
                              className='w-5 h-5'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                              />
                            </svg>
                          </a>
                        </div>
                      </div>
                    ) : null}

                    {/* Model Selection */}
                    {provider?.supportedModels && provider.supportedModels.length > 0 && (
                      <div>
                        <div className='flex items-center justify-between mb-2'>
                          <label className='block text-sm font-medium text-gray-300'>
                            模型選擇
                          </label>
                          <div className='flex items-center space-x-2'>
                            <button
                              onClick={() => fetchAvailableModels(providerType)}
                              disabled={fetchingModels[providerType]}
                              className='px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded transition-colors flex items-center space-x-1'
                            >
                              {fetchingModels[providerType] ? (
                                <>
                                  <svg
                                    className='animate-spin -ml-1 mr-1 h-3 w-3 text-white'
                                    xmlns='http://www.w3.org/2000/svg'
                                    fill='none'
                                    viewBox='0 0 24 24'
                                  >
                                    <circle
                                      className='opacity-25'
                                      cx='12'
                                      cy='12'
                                      r='10'
                                      stroke='currentColor'
                                      strokeWidth='4'
                                    ></circle>
                                    <path
                                      className='opacity-75'
                                      fill='currentColor'
                                      d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                                    ></path>
                                  </svg>
                                  <span>獲取中</span>
                                </>
                              ) : (
                                <span>🔄 獲取模型列表</span>
                              )}
                            </button>
                            <button
                              onClick={() =>
                                setUseCustomModel(prev => ({
                                  ...prev,
                                  [providerType]: !prev[providerType],
                                }))
                              }
                              className='px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors'
                            >
                              {useCustomModel[providerType] ? '📋 使用列表' : '✏️ 自訂輸入'}
                            </button>
                          </div>
                        </div>

                        {useCustomModel[providerType] ? (
                          <input
                            type='text'
                            value={config.model || ''}
                            onChange={e =>
                              handleConfigUpdate(providerType, 'model', e.target.value)
                            }
                            placeholder='請輸入模型名稱 (例如: gpt-4, llama3.2:latest)'
                            className='w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
                          />
                        ) : (
                          <select
                            value={
                              config.model ||
                              availableModels[providerType]?.[0] ||
                              provider.supportedModels[0]
                            }
                            onChange={e =>
                              handleConfigUpdate(providerType, 'model', e.target.value)
                            }
                            className='w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
                          >
                            {(availableModels[providerType] || provider.supportedModels).map(
                              model => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ),
                            )}
                          </select>
                        )}

                        {availableModels[providerType] &&
                          availableModels[providerType].length > 0 && (
                            <p className='text-xs text-gray-400 mt-1'>
                              已動態獲取 {availableModels[providerType].length} 個可用模型
                            </p>
                          )}
                      </div>
                    )}

                    {/* Temperature */}
                    <div>
                      <label className='block text-sm font-medium text-gray-300 mb-2'>
                        創造性 (Temperature): {config.temperature || 0.7}
                      </label>
                      <input
                        type='range'
                        min='0'
                        max='2'
                        step='0.1'
                        value={config.temperature || 0.7}
                        onChange={e =>
                          handleConfigUpdate(
                            providerType,
                            'temperature',
                            parseFloat(e.target.value),
                          )
                        }
                        className='w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider'
                      />
                      <div className='flex justify-between text-xs text-gray-400 mt-1'>
                        <span>保守 (0)</span>
                        <span>平衡 (1)</span>
                        <span>創新 (2)</span>
                      </div>
                    </div>

                    {/* Max Tokens */}
                    <div>
                      <label className='block text-sm font-medium text-gray-300 mb-2'>
                        最大回應長度 (Max Tokens)
                      </label>
                      <input
                        type='number'
                        min='100'
                        max='32000'
                        step='100'
                        value={config.maxTokens || 4096}
                        onChange={e =>
                          handleConfigUpdate(providerType, 'maxTokens', parseInt(e.target.value))
                        }
                        className='w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
                      />
                    </div>

                    {/* Test Button */}
                    <div className='pt-4'>
                      <button
                        onClick={() => testProvider(providerType)}
                        disabled={testingProvider === providerType || status.status !== 'ready'}
                        className='w-full px-4 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all duration-200'
                      >
                        {testingProvider === providerType ? (
                          <span className='flex items-center justify-center'>
                            <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2'></div>
                            測試中...
                          </span>
                        ) : (
                          '測試連接'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProviderSettings;
