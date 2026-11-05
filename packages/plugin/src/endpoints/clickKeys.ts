import type { PayloadRequest } from 'payload'
import type { EndpointContext } from '../types/endpoints.js'
import type { StartExperiment } from '../transitions/checkStart.js'
import { goalContent } from '../goals/fairness.js'
import { XpRefusal } from '../errors.js'

export async function handleClickKeys<TUser extends { id: string | number }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  const id = req.routeParams?.id
  if (typeof id !== 'string' && typeof id !== 'number') throw new XpRefusal('invalid-body', 'Choose a test.', undefined, 422)
  const experiment = await req.payload.findByID({ collection: 'xp-experiments', id, req, overrideAccess: false, depth: 0 })
  const content = await goalContent(req, options, experiment as unknown as StartExperiment)
  return Response.json({ keys: content.keys })
}
