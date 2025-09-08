import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className='min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4'>
          <div className='bg-gray-800/90 backdrop-blur-sm rounded-2xl p-8 max-w-2xl w-full shadow-2xl border border-gray-700/50'>
            <div className='text-center mb-6'>
              <div className='w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4'>
                <svg
                  className='w-8 h-8 text-red-400'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
              </div>
              <h1 className='text-2xl font-bold text-white mb-2'>發生錯誤</h1>
              <p className='text-gray-300 mb-4'>
                應用程式遇到了意外錯誤。請嘗試重新載入頁面，或聯繫技術支援。
              </p>
            </div>

            {this.state.error && (
              <div className='bg-gray-900/50 rounded-lg p-4 mb-6 border border-gray-700/30'>
                <h3 className='text-sm font-semibold text-red-400 mb-2'>錯誤詳情：</h3>
                <div className='text-xs text-gray-400 font-mono space-y-2'>
                  <div>
                    <span className='text-red-300'>錯誤訊息：</span>
                    <span className='ml-2'>{this.state.error.message}</span>
                  </div>
                  {this.state.error.stack && (
                    <details className='group'>
                      <summary className='cursor-pointer text-gray-500 hover:text-gray-300 transition-colors'>
                        <span className='text-red-300'>錯誤堆疊</span>
                        <span className='ml-2 group-open:hidden'>（點擊展開）</span>
                        <span className='ml-2 hidden group-open:inline'>（點擊收起）</span>
                      </summary>
                      <pre className='mt-2 text-xs bg-gray-900/80 p-3 rounded border border-gray-700/50 overflow-x-auto whitespace-pre-wrap'>
                        {this.state.error.stack}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            )}

            <div className='flex flex-col sm:flex-row gap-3 justify-center'>
              <button
                onClick={this.handleReset}
                className='px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-medium transition-colors duration-200 shadow-lg hover:shadow-xl'
              >
                重試
              </button>
              <button
                onClick={this.handleReload}
                className='px-6 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-xl font-medium transition-colors duration-200 shadow-lg hover:shadow-xl'
              >
                重新載入頁面
              </button>
            </div>

            <div className='mt-6 text-center'>
              <p className='text-xs text-gray-500'>
                如果問題持續發生，請檢查瀏覽器控制檯的詳細錯誤訊息，或聯繫技術支援。
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
