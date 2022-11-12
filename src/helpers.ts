import { ChildProcess, exec } from "child_process";
import { Contract, ethers, Signer } from "ethers";
import * as fs from "fs";
import glob from "glob";
import { HardhatPluginError } from "hardhat/plugins";

import { HuffDeployer } from "./HuffDeployer";

/**
 * Verifies that the Huff compiler (Rust version) is installed.
 */
async function verifyHuffCompiler(): Promise<void> {
  const huffUrl = "https://github.com/huff-language/huff-rs";
  const output: string = await new Promise((resolve, reject) => {
    const process = exec(`huffc --version`, (err, stdout) => {
      if (err !== null) {
        throw new HardhatPluginError(
          "huff-deployer",
          `Huff compiler not found. Please install it from ${huffUrl}`
        );
      }
      if (stdout.includes("0.0.")) {
        throw new HardhatPluginError(
          "huff-deployer",
          `TS Huff not supported. Please install the Rust compiler from ${huffUrl}`
        );
      }
      resolve(stdout);
    });
    process.stdin!.end();
  });
}

/**
 * @param filePath The path to the file where the contract is located.
 * @returns The contract bytecode.
 */
async function getContractBytecode(
  filePath: string,
  constructorArgs?: any[]
): Promise<string> {
  const output: string = await new Promise((resolve, reject) => {
    let process: ChildProcess;

    if (constructorArgs === undefined) {
      process = exec(`huffc ${filePath} --bytecode`, (err, stdout) => {
        if (err !== null) {
          return reject(err);
        }
        resolve(stdout);
      });
    } else {
      const args = constructorArgs.join(" ");

      process = exec(
        `huffc ${filePath} -i ${args} --bytecode`,
        (err, stdout) => {
          if (err !== null) {
            return reject(err);
          }
          resolve(stdout);
        }
      );
    }

    process!.stdin!.end();
  });

  return output;
}

/**
 * @returns The location of all the huff contracts located under
 *          the contracts folder.
 */
function returnHuffFiles(): string[] {
  return glob.sync("contracts/**/*.huff");
}

/**
 * Generates a contract interface (.sol file) from the Huff contract.
 */
async function generateContractInterface(filePath: string): Promise<void> {
  const output: string = await new Promise((resolve, reject) => {
    const process = exec(`huffc ${filePath} --interface`, (err, stdout) => {
      if (err !== null) {
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

async function generateArtifacts(contractFile: string): Promise<void> {
  const output: string = await new Promise((resolve, reject) => {
    const process = exec(
      `huffc ${contractFile} --output-directory --huff-artifacts`,
      (err, stdout) => {
        if (err !== null) {
          return reject(err);
        }
        resolve(stdout);
      }
    );
  });
}

/**
 *  @notice Ethers doesn't accept the artifact generated by the huff compiler.
 *  So we get the abi in a very 'hacky' way.
 *
 *  @todo Find a better way to do this.
 */
function getContractAbi(filePath: string): string[] {
  const interfaceFilePath = filePath
    .replace(".huff", ".sol")
    .replace(/\/([^\/]*)$/, "/I$1");

  const contractInterface = fs.readFileSync(interfaceFilePath, "utf8");

  const abi: string[] = [];
  for (const line of contractInterface.split("\n")) {
    if (line.includes("function")) {
      abi.push(line.slice(line.indexOf("function"), line.indexOf(";")));
    }
  }

  return abi;
}

/**
 * Deploys a Huff contract.
 * @returns The deployed contract.
 *
 * @todo Create a cache. We currently do everything everytime.
 */
export async function deploy(
  this: HuffDeployer,
  targetContract: string,
  signer: Signer,
  constructorArgs?: any[]
): Promise<Contract> {
  await verifyHuffCompiler();

  const huffFiles = returnHuffFiles();

  let contract: Contract;

  for (const filePath of huffFiles) {
    const contractName = filePath.slice(
      filePath.lastIndexOf("/") + 1,
      filePath.indexOf(".huff")
    );

    if (targetContract.toLowerCase() === contractName.toLowerCase()) {
      const bytecode = await getContractBytecode(filePath, constructorArgs);

      // We auto generate  the contract interface.
      await generateContractInterface(filePath);

      // We auto generate the huff artifacts.
      // await generateArtifactsc(file);

      const abi = getContractAbi(filePath);

      const factory = await this.hre.ethers.getContractFactory(
        abi,
        bytecode,
        signer
      );

      try {
        contract = await factory.deploy();
      } catch (e) {
        throw new Error(`Error deploying ${targetContract}: ${e}`);
      }
    }
  }

  if (contract! === undefined) {
    throw new HardhatPluginError(
      "HuffDeployer",
      `Contract ${targetContract} not found.`
    );
  } else {
    return contract;
  }
}
