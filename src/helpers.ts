import { ChildProcess, exec } from "child_process";
import { Contract, ethers, Signer } from "ethers";
import * as fs from "fs";
import glob from "glob";
import { HardhatPluginError } from "hardhat/plugins";

import { HuffDeployer } from "./HuffDeployer";

/**
 * Describes an argument to be passed to the Huff compiler
 */
export interface CompilerArg {
  key: number;
  value: number;
  full: boolean;
}

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
 * @param constructorArgs The arguments to pass to the contract constructor
 * @param compilerArgs Optionally specify arguments to pass to the huff compiler
 * @returns The contract bytecode.
 */
async function getContractBytecode(
  filePath: string,
  constructorArgs?: any[],
  compilerArgs?: CompilerArg[]
): Promise<string> {
  const output: string = await new Promise((resolve, reject) => {
    let process: ChildProcess;

    let argString = "";

    if (compilerArgs) {
      argString = " ";
      for (const arg of compilerArgs) {
        const key = arg.full ? `--${arg.key}` : `-${arg.key}`;
        argString = argString + ` ${key} ${arg.value}`;
      }
    }

    if (constructorArgs === undefined) {
      process = exec(
        `huffc ${filePath} --bytecode${argString}`,
        (err, stdout) => {
          if (err !== null) {
            return reject(err);
          }
          resolve(stdout);
        }
      );
    } else {
      const args = constructorArgs.join(" ");

      process = exec(
        `huffc ${filePath} -i ${args} --bytecode${argString}`,
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
 * @notice Deletes the auto generated .sol files.
 */
function clean(filePath: string): void {
  filePath = filePath.replace("huff", "sol");
  const lastSlashIndex = filePath.lastIndexOf("/");
  filePath =
    filePath.slice(0, lastSlashIndex + 1) +
    "I" +
    filePath.slice(lastSlashIndex + 1);

  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error(`Error deleting ${filePath}: ${err}`);
  }
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
  generateInterface: boolean,
  constructorArgs?: any[],
  compilerArgs?: CompilerArg[]
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
      const bytecode = await getContractBytecode(
        filePath,
        constructorArgs,
        compilerArgs
      );

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

      if (!generateInterface) {
        clean(filePath);
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
