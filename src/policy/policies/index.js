'use strict';

const engine = require('../policy.engine');

const buildOptOut               = require('./routerAi/optOut.policy');
const buildCampaignChannel      = require('./routerAi/campaignChannel.policy');
const buildChannelConnected     = require('./routerAi/channelConnected.policy');
const buildChannelBalance       = require('./routerAi/channelBalance.policy');
const buildPlanLimits           = require('./routerAi/planLimits.policy');
const buildRiskGates            = require('./routerAi/riskGates.policy');
const buildExperimentalChannel  = require('./routerAi/experimentalChannel.policy');

let registered = false;

function registerAll() {
  if (registered) return;

  engine.register('router_ai.routing', buildOptOut());
  engine.register('router_ai.routing', buildCampaignChannel());
  engine.register('router_ai.routing', buildChannelConnected());
  engine.register('router_ai.routing', buildChannelBalance());
  engine.register('router_ai.routing', buildPlanLimits());
  engine.register('router_ai.routing', buildRiskGates());
  engine.register('router_ai.routing', buildExperimentalChannel());

  registered = true;
}

module.exports = { registerAll };
