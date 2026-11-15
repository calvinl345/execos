export interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  duration: number;
}

let toasts = $state<ToastItem[]>([]);

export const toast = {
  get items() {
    return toasts;
  },

  add(message: string, type: ToastItem["type"] = "info", duration = 2000) {
    const id = Math.random().toString(36).substring(2, 9);
    
    // Maintain a max limit of 3 toasts (shift oldest out)
    if (toasts.length >= 3) {
      toasts.shift();
    }

    toasts.push({ id, message, type, duration });

    setTimeout(() => {
      this.dismiss(id);
    }, duration);
  },

  success(message: string, duration?: number) {
    this.add(message, "success", duration);
  },

  error(message: string, duration?: number) {
    this.add(message, "error", duration);
  },

  info(message: string, duration?: number) {
    this.add(message, "info", duration);
  },

  dismiss(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
  }
};
export default toast;
