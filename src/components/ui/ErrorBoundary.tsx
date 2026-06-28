import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">เกิดข้อผิดพลาด</h2>
          <p className="text-sm text-gray-500 mb-4">
            {this.state.error?.message || 'ไม่สามารถแสดงเนื้อหาได้'}
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            ลองใหม่
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface ErrorCardProps {
  message?: string;
  error?: Error | null;
  onRetry?: () => void;
}

export function ErrorCard({ message, error, onRetry }: ErrorCardProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-xl border border-red-200 text-center">
      <AlertTriangle className="w-10 h-10 text-red-500 mb-3" />
      <h3 className="text-base font-semibold text-red-700 mb-1">โหลดข้อมูลไม่สำเร็จ</h3>
      <p className="text-sm text-red-500 mb-2">
        {message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่'}
      </p>
      {error?.message && (
        <p className="text-xs text-red-400 bg-red-100 rounded px-3 py-1.5 mb-4 max-w-md break-all font-mono">
          {error.message}
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          ลองใหม่อีกครั้ง
        </button>
      )}
    </div>
  );
}
