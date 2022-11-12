import { Contract, Signer } from "ethers";
import { ProviderWrapper } from "hardhat/internal/core/providers/wrapper";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { deploy } from "./helpers";

/**
 * HuffDeployer - Hardhat plugin for deploying Huff contracts.
 */
export class HuffDeployer {
  constructor(public hre: HardhatRuntimeEnvironment) {}

  /**
   * Deploys a huff contract.
   *
   * @param targetContract The name of the huff contract to deploy.
   * @param constructorArgs The constructor arguments for the contract.
   * @param signer The signer to use for the deployment.
   *               It left undefined, the signer 0 from Hardhat will be used.
   *
   * @returns The deployed contract or throws an Error.
   */
  public async deploy(
    targetContract: string,
    constructorArgs?: any[],
    signer?: Signer
  ): Promise<Contract> {
    if (signer === undefined) {
      const signers = await this.hre.ethers.getSigners();
      signer = signers[0];
    }

    return deploy.bind(this)(targetContract, signer, constructorArgs);
  }
}
