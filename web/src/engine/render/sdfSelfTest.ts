import { int, screenCoordinate, uniformArray, vec4 } from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { LogMessage } from '../../protocol'
import conformance from '../organic/conformance.json'
import { compileScene } from '../organic/graph'
import { buildDistanceFn, createParamArray } from '../organic/tslCodegen'
import type { SdfTree } from '../organic/tree'

/** Shader distances are 32-bit floats, so they match the hand-worked values only this closely. */
const TOLERANCE = 1e-3

/**
 * Checks the SDF shader against the conformance vectors: for each case it renders one pixel per
 * test point, with the pixel's value being the distance there, and reads the pixels back.
 */
export async function runSdfSelfTest(renderer: THREE.WebGPURenderer): Promise<LogMessage[]> {
  const messages: LogMessage[] = []
  const quad = new THREE.QuadMesh(new THREE.MeshBasicNodeMaterial())
  let failures = 0
  let checked = 0

  for (const testCase of conformance.cases) {
    const points = testCase.points as number[][]
    const graph = compileScene(testCase.trees as unknown as SdfTree[])
    const distance = buildDistanceFn(graph, createParamArray(graph).node)
    const positions = uniformArray<'vec3'>(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      'vec3',
    )

    const material = new THREE.NodeMaterial()
    material.fragmentNode = vec4(distance(positions.element(int(screenCoordinate.x))), 0, 0, 1)
    const target = new THREE.RenderTarget(points.length, 1, {
      type: THREE.FloatType,
      depthBuffer: false,
    })
    quad.material = material
    renderer.setRenderTarget(target)
    quad.render(renderer)
    renderer.setRenderTarget(null)
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, points.length, 1)
    target.dispose()
    material.dispose()

    points.forEach(([x, y, z, expected], index) => {
      const actual = pixels[index * 4]!
      checked += 1
      if (Math.abs(actual - expected!) > TOLERANCE) {
        failures += 1
        messages.push({
          kind: 'error',
          text: `${testCase.name}: at (${x}, ${y}, ${z}) the shader gives ${actual}, expected ${expected}`,
        })
      }
    })
  }

  const summary = `SDF shader self-test: ${checked - failures} of ${checked} points match across ${conformance.cases.length} cases`
  messages.push({ kind: failures ? 'error' : 'info', text: summary })
  return messages
}
