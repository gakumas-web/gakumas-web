// 静态资源瞬时失败后短暂等待，只重试一次；离开页面的图片不再请求。
export function watchImage(image, onLoad = () => {}, onError = () => {}) {
  let retried = false;
  let resourceFailed=false;
  image.addEventListener('resource-error',()=>{resourceFailed=true;image.hidden=true;onError(false);});
  image.onload = () => {
    if(image.src.includes('#resource=')){image.hidden=resourceFailed;return;}
    resourceFailed=false;image.hidden=false;onLoad();
  };
  image.onerror = () => {
    image.hidden = true;
    const willRetry = !retried;
    onError(willRetry);
    if (!willRetry) return;
    retried = true;
    setTimeout(() => {
      if (!image.isConnected) return;
      // 隐藏的懒加载图片没有可见区域，恢复请求时必须显式加载。
      image.loading = 'eager';
      image.src = image.src;
    }, 1000);
  };
}
