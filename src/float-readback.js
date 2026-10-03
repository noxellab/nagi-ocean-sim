export function readFloatProbe(
  renderer,
  target,
  x,
  y,
  width,
  height,
  face = 0,
  attachment = 0,
) {
  if (!target?.isWebGLRenderTarget || target.samples > 0)
    throw new Error("Float probe requires a single-sample render target");
  if (
    !Number.isInteger(attachment) ||
    attachment < 0 ||
    attachment >= target.textures.length
  )
    throw new Error("Invalid float probe attachment");
  if (
    !Number.isInteger(face) ||
    face < 0 ||
    face > (target.isWebGLCubeRenderTarget ? 5 : 0)
  )
    throw new Error("Invalid float probe face");
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > target.width ||
    y + height > target.height
  )
    throw new Error("Float probe bounds are invalid");
  const gl = renderer.getContext(),
    previous = renderer.getRenderTarget(),
    oldFace = renderer.getActiveCubeFace(),
    oldLevel = renderer.getActiveMipmapLevel();
  const oldReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
    oldReadBuffer = gl.getParameter(gl.READ_BUFFER);
  const oldPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  const packNames = [
      gl.PACK_ALIGNMENT,
      gl.PACK_ROW_LENGTH,
      gl.PACK_SKIP_PIXELS,
      gl.PACK_SKIP_ROWS,
    ],
    pack = packNames.map((name) => gl.getParameter(name));
  const viewport = gl.getParameter(gl.VIEWPORT),
    scissor = gl.getParameter(gl.SCISSOR_BOX),
    scissorTest = gl.isEnabled(gl.SCISSOR_TEST);
  let sourceFramebuffer, sourceReadBuffer;
  const data = new Float32Array(width * height * 4);
  data.fill(NaN);
  try {
    renderer.setRenderTarget(target, face, 0);
    sourceFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
    sourceReadBuffer = gl.getParameter(gl.READ_BUFFER);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
    if (
      gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
    )
      throw new Error("Float probe framebuffer is incomplete");
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    for (let i = 0; i < packNames.length; i++)
      gl.pixelStorei(packNames[i], i === 0 ? 4 : 0);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, data);
    return data;
  } finally {
    try {
      for (let i = 0; i < packNames.length; i++)
        gl.pixelStorei(packNames[i], pack[i]);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, oldPackBuffer);
      if (sourceReadBuffer !== undefined) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
        gl.readBuffer(sourceReadBuffer);
      }
    } finally {
      const savedViewport = previous?.viewport.clone(),
        savedScissor = previous?.scissor.clone(),
        savedScissorTest = previous?.scissorTest;
      try {
        if (previous) {
          previous.viewport.fromArray(viewport);
          previous.scissor.fromArray(scissor);
          previous.scissorTest = scissorTest;
        }
        renderer.setRenderTarget(previous, oldFace, oldLevel);
      } finally {
        if (previous) {
          previous.viewport.copy(savedViewport);
          previous.scissor.copy(savedScissor);
          previous.scissorTest = savedScissorTest;
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, oldReadFramebuffer);
        gl.readBuffer(oldReadBuffer);
      }
    }
  }
}
